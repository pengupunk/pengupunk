// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @title PenguMarket
/// @notice Pasar sekunder Pengupunk: ask + bid dengan escrow.
///         list / cancel / buy + bid / cancelBid / acceptBid.
///         Fee 2% + royalti ERC2981 (2,5%) diteruskan ke penerima royalti.
///         Tanpa owner, tanpa pause, tanpa withdraw — dana tidak pernah mengendap di kontrak
///         kecuali escrow bid, yang selalu bisa ditarik kembali oleh pemberi bid.
contract PenguMarket {
    uint256 public constant FEE_BPS = 200; // 2%

    IERC721 public immutable collection;
    address payable public immutable treasury;

    struct Listing {
        address seller;
        uint96 price;
        uint64 expiry;
    }

    struct Bid {
        address bidder;
        uint96 amount;
        uint64 expiry;
    }

    mapping(uint256 => Listing) public listing;
    mapping(uint256 => Bid) public bestBid;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiry);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price, uint256 fee, uint256 royalty);
    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint256 amount, uint64 expiry);
    event BidCancelled(uint256 indexed tokenId, address indexed bidder, uint256 refund);
    event BidAccepted(uint256 indexed tokenId, address indexed bidder, address indexed seller, uint256 amount, uint256 fee, uint256 royalty);

    error NotOwner();
    error NotApproved();
    error BadPrice();
    error BadExpiry();
    error NotListed();
    error Expired();
    error WrongPayment();
    error BuyerIsSeller();
    error BidTooLow();
    error BidderIsSeller();
    error NoBid();
    error TransferFailed();

    constructor(address collection_, address payable treasury_) {
        require(collection_ != address(0) && treasury_ != address(0), "addr");
        collection = IERC721(collection_);
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ asks

    function list(uint256 tokenId, uint256 price, uint64 durationDays) external {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price == 0) revert BadPrice();
        if (durationDays == 0 || durationDays > 365) revert BadExpiry();
        if (collection.getApproved(tokenId) != address(this) &&
            !collection.isApprovedForAll(msg.sender, address(this))) revert NotApproved();

        uint64 expiry = uint64(block.timestamp) + durationDays * 1 days;
        listing[tokenId] = Listing(msg.sender, uint96(price), expiry);
        emit Listed(tokenId, msg.sender, price, expiry);
    }

    function cancel(uint256 tokenId) external {
        if (listing[tokenId].seller != msg.sender) revert NotOwner();
        delete listing[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    function buy(uint256 tokenId) external payable {
        Listing memory l = listing[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.expiry != 0 && block.timestamp > l.expiry) revert Expired();
        if (msg.sender == l.seller) revert BuyerIsSeller();
        if (msg.value != l.price) revert WrongPayment();

        delete listing[tokenId];
        _settle(tokenId, msg.sender, l.seller, l.price, false);
    }

    // ------------------------------------------------- bids (escrow, refundable)

    function bid(uint256 tokenId, uint64 durationDays) external payable {
        if (msg.value == 0) revert BadPrice();
        if (durationDays == 0 || durationDays > 365) revert BadExpiry();

        Bid memory prev = bestBid[tokenId];
        if (prev.bidder != address(0) && prev.expiry > block.timestamp) {
            if (msg.value <= prev.amount) revert BidTooLow();
        }
        if (collection.ownerOf(tokenId) == msg.sender) revert BidderIsSeller();

        bestBid[tokenId] = Bid(msg.sender, uint96(msg.value), uint64(block.timestamp) + durationDays * 1 days);
        emit BidPlaced(tokenId, msg.sender, msg.value, uint64(block.timestamp) + durationDays * 1 days);

        if (prev.bidder != address(0) && prev.bidder != msg.sender) {
            (bool ok, ) = payable(prev.bidder).call{value: prev.amount}("");
            if (!ok) revert TransferFailed();
        }
    }

    function cancelBid(uint256 tokenId) external {
        Bid memory b = bestBid[tokenId];
        if (b.bidder != msg.sender) revert NoBid();
        delete bestBid[tokenId];
        (bool ok, ) = payable(msg.sender).call{value: b.amount}("");
        if (!ok) revert TransferFailed();
        emit BidCancelled(tokenId, msg.sender, b.amount);
    }

    /// @notice seller menerima bid yang berlaku; butuh approval ke market ini
    function acceptBid(uint256 tokenId) external {
        Bid memory b = bestBid[tokenId];
        if (b.bidder == address(0)) revert NoBid();
        if (block.timestamp > b.expiry) revert Expired();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (collection.getApproved(tokenId) != address(this) &&
            !collection.isApprovedForAll(msg.sender, address(this))) revert NotApproved();

        delete bestBid[tokenId];
        _settle(tokenId, b.bidder, msg.sender, b.amount, true);
    }

    // ---------------------------------------------------------------- internal

    function _settle(uint256 tokenId, address buyer, address seller, uint256 amount, bool fromBid) internal {
        uint256 fee = (amount * FEE_BPS) / 10_000;

        // royalti ERC2981 (kalau koleksi mendukungnya)
        uint256 royalty;
        address payable royaltyTo = treasury;
        try IERC2981(address(collection)).royaltyInfo(tokenId, amount) returns (address rTo, uint256 rAmount) {
            if (rTo != address(0) && rAmount > 0 && rAmount + fee <= amount) {
                royalty = rAmount;
                royaltyTo = payable(rTo);
            }
        } catch {}

        uint256 toSeller = amount - fee - royalty;

        collection.safeTransferFrom(seller, buyer, tokenId);

        if (fee > 0) {
            (bool ok1, ) = treasury.call{value: fee}("");
            if (!ok1) revert TransferFailed();
        }
        if (royalty > 0 && royaltyTo != treasury) {
            (bool ok2, ) = royaltyTo.call{value: royalty}("");
            if (!ok2) revert TransferFailed();
        } else if (royalty > 0) {
            (bool ok2b, ) = treasury.call{value: royalty}("");
            if (!ok2b) revert TransferFailed();
        }
        (bool ok3, ) = payable(seller).call{value: toSeller}("");
        if (!ok3) revert TransferFailed();

        if (fromBid) {
            emit BidAccepted(tokenId, buyer, seller, amount, fee, royalty);
        } else {
            emit Sold(tokenId, buyer, seller, amount, fee, royalty);
        }
    }
}
