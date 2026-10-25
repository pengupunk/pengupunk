// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IAgentRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Pengupunk — agent-gated punk penguin on BNB Chain
/// @notice Tanpa owner, pause, withdraw, atau setPrice. Rarity dari kombinasi aksesoris.
/// Ditulis tanpa viaIR (stack dipecah per fungsi) supaya bisa diverifikasi di BscScan.
contract Pengupunk is ERC721, ERC2981 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 2222;
    uint256 public constant MAX_PER_WALLET = 3;
    uint256 public constant PRICE_FIRST = 0.001 ether;
    uint256 public constant PRICE_SECOND = 0.0005 ether;
    uint256 public constant FREE_QUOTA = 223;
    uint96 public constant ROYALTY_BPS = 250;

    IAgentRegistry public immutable agentRegistry;
    address payable public immutable treasury;
    uint256 public immutable revealBlock;
    bytes32 public immutable provenanceCommit;

    uint256 public totalMinted;
    uint256 public freeGranted;
    uint256 public seed;

    mapping(address => uint256) public mintedBy;

    event Minted(address indexed to, uint256 firstId, uint256 qty, uint256 paid, bool thirdFree);
    event Revealed(bytes32 secret, uint256 seed);

    constructor(address registry_, address payable treasury_, uint256 revealDelayBlocks_, bytes32 provenanceCommit_)
        ERC721("Pengupunk", "PUNK")
    {
        require(registry_ != address(0) && treasury_ != address(0), "addr");
        require(provenanceCommit_ != bytes32(0), "commit");
        require(revealDelayBlocks_ > 0, "delay");
        agentRegistry = IAgentRegistry(registry_);
        treasury = treasury_;
        revealBlock = block.number + revealDelayBlocks_;
        provenanceCommit = provenanceCommit_;
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
    }

    // ------------------------------------------------------------------ mint

    function priceFor(address wallet, uint256 qty) public view returns (uint256) {
        uint256 already = mintedBy[wallet];
        uint256 freeLeft = FREE_QUOTA - freeGranted;
        uint256 cost;
        for (uint256 i = 0; i < qty; i++) {
            uint256 slot = already + i + 1;
            if (slot == 1) cost += PRICE_FIRST;
            else if (slot == 2) cost += PRICE_SECOND;
            else if (slot == 3) {
                if (freeLeft > 0) freeLeft -= 1;
                else cost += PRICE_SECOND;
            } else revert("max per wallet");
        }
        return cost;
    }

    function mint(uint256 qty) external payable {
        require(qty >= 1 && qty <= MAX_PER_WALLET, "qty");
        require(mintedBy[msg.sender] + qty <= MAX_PER_WALLET, "max per wallet");
        require(totalMinted + qty <= MAX_SUPPLY, "sold out");
        require(agentRegistry.balanceOf(msg.sender) > 0, "not agent");

        uint256 cost = priceFor(msg.sender, qty);
        require(msg.value >= cost, "underpaid");

        uint256 already = mintedBy[msg.sender];
        mintedBy[msg.sender] = already + qty;

        bool thirdFree;
        uint256 freeLeft = FREE_QUOTA - freeGranted;
        for (uint256 i = 0; i < qty; i++) {
            if (already + i + 1 == 3 && freeLeft > 0) {
                freeLeft -= 1;
                freeGranted += 1;
                thirdFree = true;
            }
        }

        uint256 startId = totalMinted + 1;
        totalMinted += qty;
        for (uint256 i = 0; i < qty; i++) _safeMint(msg.sender, startId + i);

        if (cost > 0) {
            (bool ok, ) = treasury.call{value: cost}("");
            require(ok, "treasury");
        }
        if (msg.value > cost) {
            (bool back, ) = msg.sender.call{value: msg.value - cost}("");
            require(back, "refund");
        }
        emit Minted(msg.sender, startId, qty, cost, thirdFree);
    }

    // ---------------------------------------------------------------- reveal

    function reveal(bytes32 secret_) external {
        require(seed == 0, "revealed");
        require(block.number >= revealBlock, "too early");
        require(keccak256(abi.encodePacked(secret_)) == provenanceCommit, "bad secret");
        seed = uint256(keccak256(abi.encode(blockhash(revealBlock), secret_)));
        emit Revealed(secret_, seed);
    }

    // ---------------------------------------------------------------- traits

    function _hash(uint256 tokenId) internal view returns (uint256) {
        require(seed != 0, "not revealed");
        return uint256(keccak256(abi.encodePacked(seed, tokenId)));
    }

    function _idx(uint256 r, uint8[6] memory w) internal pure returns (uint256) {
        uint256 acc;
        for (uint256 i = 0; i < 6; i++) {
            if (w[i] == 0) break;
            acc += w[i];
            if (r < acc) return i;
        }
        return 0;
    }

    function _wt(uint256 r, uint8[6] memory w) internal pure returns (uint256) {
        uint256 acc;
        for (uint256 i = 0; i < 6; i++) {
            if (w[i] == 0) break;
            acc += w[i];
            if (r < acc) return w[i];
        }
        return w[0];
    }

    function mohawkOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 8) % 100, [45, 26, 16, 9, 4, 0]);
        if (i == 1) return "single";
        if (i == 2) return "wide";
        if (i == 3) return "twin";
        if (i == 4) return "flame";
        return "none";
    }

    function shadesOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 24) % 100, [40, 30, 16, 10, 4, 0]);
        if (i == 1) return "narrow";
        if (i == 2) return "round";
        if (i == 3) return "visor";
        if (i == 4) return "eyepatch";
        return "none";
    }

    function collarOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 40) % 100, [42, 30, 18, 10, 0, 0]);
        if (i == 1) return "studs";
        if (i == 2) return "spikes";
        if (i == 3) return "chain";
        return "none";
    }

    function accessoryOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 56) % 100, [40, 24, 18, 11, 5, 2]);
        if (i == 1) return "earring";
        if (i == 2) return "pin";
        if (i == 3) return "patch";
        if (i == 4) return "tattoo";
        if (i == 5) return "bandana";
        return "none";
    }

    function backgroundOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 72) % 100, [50, 24, 15, 8, 3, 0]);
        if (i == 1) return "teal";
        if (i == 2) return "crimson";
        if (i == 3) return "gold";
        if (i == 4) return "static";
        return "void";
    }

    function beakOf(uint256 t) public view returns (string memory) {
        uint256 i = _idx((_hash(t) >> 88) % 100, [70, 20, 8, 2, 0, 0]);
        if (i == 1) return "goldtooth";
        if (i == 2) return "scar";
        if (i == 3) return "bandaid";
        return "normal";
    }

    function rarityScoreOf(uint256 t) public view returns (uint256) {
        uint256 h = _hash(t);
        uint256 s = _wt((h >> 8) % 100, [45, 26, 16, 9, 4, 0]);
        s = (s * _wt((h >> 24) % 100, [40, 30, 16, 10, 4, 0]));
        s = (s * _wt((h >> 40) % 100, [42, 30, 18, 10, 0, 0]));
        s = (s * _wt((h >> 56) % 100, [40, 24, 18, 11, 5, 2]));
        s = (s * _wt((h >> 72) % 100, [50, 24, 15, 8, 3, 0]));
        s = (s * _wt((h >> 88) % 100, [70, 20, 8, 2, 0, 0]));
        return s;
    }

    function tierOf(uint256 t) public view returns (string memory) {
        uint256 s = rarityScoreOf(t);
        if (s <= 3456000) return "Mythic";
        if (s <= 11182080) return "Legendary";
        if (s <= 37440000) return "Epic";
        if (s <= 131040000) return "Rare";
        if (s <= 476280000) return "Uncommon";
        return "Common";
    }

    // -------------------------------------------------------------- tokenURI

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (seed == 0) return _sealedURI(tokenId);
        string memory head = string.concat(
            '{"name":"Pengupunk #',
            tokenId.toString(),
            '","description":"Punk penguin, agent-gated on BNB Chain. No owner, no withdraw. Traits and rarity sealed by block hash.","attributes":'
        );
        string memory body = string.concat(head, _attrs(tokenId));
        string memory img = string.concat(',"image":"data:image/svg+xml;base64,', Base64.encode(bytes(_svg(tokenId))), '"}');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(body, img))));
    }

    function _attrs(uint256 t) internal view returns (string memory) {
        return string.concat(
            '[{"trait_type":"Tier","value":"', tierOf(t), '"},',
            '{"trait_type":"Mohawk","value":"', mohawkOf(t), '"},',
            '{"trait_type":"Shades","value":"', shadesOf(t), '"},',
            '{"trait_type":"Collar","value":"', collarOf(t), '"},',
            '{"trait_type":"Accessory","value":"', accessoryOf(t), '"},',
            '{"trait_type":"Background","value":"', backgroundOf(t), '"},',
            '{"trait_type":"Beak","value":"', beakOf(t), '"}]'
        );
    }

    function _sealedURI(uint256 tokenId) internal pure returns (string memory) {
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" shape-rendering="crispEdges">',
            '<rect width="320" height="320" fill="#0a0c10"/>',
            '<rect x="40" y="40" width="240" height="240" fill="#11141b" stroke="#2a2f3a" stroke-width="2"/>',
            '<text x="160" y="156" font-family="monospace" font-size="20" fill="#6b7280" text-anchor="middle">SEALED</text>',
            '<text x="160" y="184" font-family="monospace" font-size="14" fill="#4b5563" text-anchor="middle">#',
            tokenId.toString(),
            "</text></svg>"
        );
        string memory json = string.concat(
            '{"name":"Pengupunk #',
            tokenId.toString(),
            ' (sealed)","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(uint256 t) internal view returns (string memory) {
        string memory base = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" shape-rendering="crispEdges">',
            _bg(backgroundOf(t)),
            '<rect x="100" y="60" width="120" height="110" fill="#12141a"/>',
            '<rect x="80" y="150" width="160" height="112" fill="#12141a"/>',
            '<rect x="60" y="160" width="20" height="80" fill="#0e1015"/>',
            '<rect x="240" y="160" width="20" height="80" fill="#0e1015"/>',
            '<rect x="110" y="182" width="100" height="68" fill="#f2f0e8"/>',
            '<rect x="90" y="264" width="40" height="16" fill="#f29426"/>',
            '<rect x="190" y="264" width="40" height="16" fill="#f29426"/>'
        );
        string memory traits = string.concat(
            _mohawk(mohawkOf(t)),
            _beak(beakOf(t)),
            _shades(shadesOf(t)),
            _collar(collarOf(t)),
            _accent(accessoryOf(t))
        );
        string memory tier = tierOf(t);
        string memory tail = string.concat(
            _frame(tier),
            '<text x="160" y="306" font-family="monospace" font-size="12" fill="',
            _tierColor(tier),
            '" text-anchor="middle">',
            tier,
            " #",
            t.toString(),
            "</text></svg>"
        );
        return string.concat(base, traits, tail);
    }

    function _bg(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("teal")) return '<rect width="320" height="320" fill="#0c2a29"/>';
        if (k == keccak256("crimson")) return '<rect width="320" height="320" fill="#2a0f12"/>';
        if (k == keccak256("gold")) return '<rect width="320" height="320" fill="#2a2310"/>';
        if (k == keccak256("static")) return '<rect width="320" height="320" fill="#151922"/>';
        return '<rect width="320" height="320" fill="#0a0c10"/>';
    }

    function _mohawk(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("single")) return '<rect x="150" y="18" width="20" height="44" fill="#56d6c4"/><rect x="140" y="50" width="40" height="12" fill="#3fb3a4"/>';
        if (k == keccak256("wide")) return '<rect x="128" y="26" width="64" height="36" fill="#56d6c4"/>';
        if (k == keccak256("twin")) return '<rect x="122" y="22" width="16" height="40" fill="#ce3e3a"/><rect x="182" y="22" width="16" height="40" fill="#ce3e3a"/>';
        if (k == keccak256("flame")) return '<rect x="146" y="10" width="12" height="18" fill="#f29426"/><rect x="158" y="18" width="12" height="32" fill="#ce3e3a"/><rect x="170" y="24" width="12" height="26" fill="#f29426"/>';
        return "";
    }

    function _shades(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("narrow")) return '<rect x="108" y="96" width="104" height="16" fill="#a8aeba"/>';
        if (k == keccak256("round")) return '<rect x="112" y="92" width="36" height="26" fill="#a8aeba"/><rect x="172" y="92" width="36" height="26" fill="#a8aeba"/>';
        if (k == keccak256("visor")) return '<rect x="100" y="92" width="120" height="26" fill="#56d6c4"/><rect x="106" y="100" width="108" height="8" fill="#0a0c10"/>';
        if (k == keccak256("eyepatch")) return '<rect x="108" y="94" width="44" height="26" fill="#0a0c10"/><rect x="162" y="100" width="14" height="14" fill="#f2f0e8"/>';
        return '<rect x="122" y="100" width="14" height="14" fill="#f2f0e8"/><rect x="184" y="100" width="14" height="14" fill="#f2f0e8"/>';
    }

    function _beak(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("goldtooth")) return '<rect x="140" y="128" width="40" height="22" fill="#f29426"/><rect x="156" y="140" width="10" height="8" fill="#d4af37"/>';
        if (k == keccak256("scar")) return '<rect x="140" y="128" width="40" height="22" fill="#f29426"/><rect x="122" y="116" width="6" height="30" fill="#ce3e3a"/>';
        if (k == keccak256("bandaid")) return '<rect x="140" y="128" width="40" height="22" fill="#f29426"/><rect x="130" y="120" width="48" height="8" fill="#e8d8c0"/>';
        return '<rect x="140" y="128" width="40" height="22" fill="#f29426"/>';
    }

    function _collar(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("studs")) return '<rect x="100" y="172" width="120" height="10" fill="#20242c"/><rect x="108" y="168" width="8" height="8" fill="#a8aeba"/><rect x="148" y="168" width="8" height="8" fill="#a8aeba"/><rect x="188" y="168" width="8" height="8" fill="#a8aeba"/>';
        if (k == keccak256("spikes")) return '<rect x="100" y="172" width="120" height="10" fill="#20242c"/><rect x="104" y="158" width="8" height="16" fill="#d8dde8"/><rect x="148" y="158" width="8" height="16" fill="#d8dde8"/><rect x="192" y="158" width="8" height="16" fill="#d8dde8"/>';
        if (k == keccak256("chain")) return '<rect x="100" y="172" width="120" height="8" fill="#d4af37"/>';
        return "";
    }

    function _accent(string memory v) internal pure returns (string memory) {
        bytes32 k = keccak256(bytes(v));
        if (k == keccak256("earring")) return '<rect x="222" y="112" width="8" height="8" fill="#d4af37"/>';
        if (k == keccak256("pin")) return '<rect x="160" y="204" width="40" height="6" fill="#a8aeba"/>';
        if (k == keccak256("patch")) return '<rect x="114" y="192" width="26" height="26" fill="#20242c"/>';
        if (k == keccak256("tattoo")) return '<rect x="170" y="208" width="6" height="26" fill="#20242c"/>';
        if (k == keccak256("bandana")) return '<rect x="96" y="150" width="128" height="14" fill="#ce3e3a"/>';
        return "";
    }

    function _frame(string memory tier) internal pure returns (string memory) {
        return string.concat('<rect x="6" y="6" width="308" height="308" fill="none" stroke="', _tierColor(tier), '" stroke-width="3"/>');
    }

    function _tierColor(string memory tier) internal pure returns (string memory) {
        bytes32 t = keccak256(bytes(tier));
        if (t == keccak256("Mythic")) return "#ff5f6d";
        if (t == keccak256("Legendary")) return "#ffb347";
        if (t == keccak256("Epic")) return "#b98cff";
        if (t == keccak256("Rare")) return "#6fa8ff";
        if (t == keccak256("Uncommon")) return "#56d6c4";
        return "#6b7280";
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
