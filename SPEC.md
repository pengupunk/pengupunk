# Pengupunk — spesifikasi kontrak (v1, belum deploy)

## Identitas
- Nama: **Pengupunk**
- Simbol: **PUNK**
- Supply: **2.222** (immutable)
- Gate: wallet harus punya **SPACE ID Agent ID** (`.ai`) — `IAgentRegistry.balanceOf(wallet) > 0`
  registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Tidak ada owner, pause, withdraw, atau setPrice. Semua parameter dikunci saat deploy.

## Harga (bertingkat per wallet)
| keping ke- | harga |
|---|---|
| 1 | 0,001 BNB |
| 2 | 0,0005 BNB |
| 3 | **gratis** (kuota 223), setelah kuota habis 0,0005 BNB |
| >3 | tidak diizinkan |

- Batas: **3 keping per wallet**
- Pembayaran langsung diteruskan ke treasury pada transaksi yang sama (kontrak tidak menyimpan dana)
- Kelebihan bayar dikembalikan otomatis (refund sisa)

## Provenance (keadilan urutan & rarity)
1. Saat deploy, kontrak menyimpan:
   - `provenanceCommit = keccak256(secret)` — dipublikasikan di event dan di halaman
   - `revealBlock = deployBlock + 28.800` (≈6 jam)
2. Trait & rarity **belum ditentukan** selama mint berjalan (semua tokenURI = unrevealed)
3. Setelah `revealBlock` lewat, siapa pun boleh memanggil `reveal(secret)`.
   Kontrak memverifikasi `keccak256(secret) == provenanceCommit`, lalu:
   - `seed = uint256(keccak256(abi.encode(blockhash(revealBlock), secret)))`
   - `blockhash(revealBlock)` tidak diketahui saat deploy → tim tidak bisa memilih hasil
4. `reveal` hanya bisa dipanggil sekali. Sebelum `revealBlock`, revert.

## Rarity
Dihitung dari `keccak256(seed, tokenId) % 10000`:

| tier | jatah | porsi |
|---|---|---|
| Common | 5.500 | 55% |
| Uncommon | 2.500 | 25% |
| Rare | 1.300 | 13% |
| Epic | 500 | 5% |
| Legendary | 150 | 1,5% |
| Mythic | 50 | 0,5% |

Tabel ini dipublikasikan **sebelum** mint, dan hasilnya bisa dicek siapa pun setelah reveal.

## Art
- SVG 100% on-chain, tidak ada IPFS, tidak ada server
- 6 slot trait: `background`, `body`, `eyes`, `accessory`, `aura`, `mutation`
- Semua slot diturunkan dari hash yang sama, jadi trait bisa diverifikasi tanpa percaya metadata
- Token yang belum di-reveal menampilkan gambar "sealed" (abu-abu, ada nomor keping)

## Royalty
EIP-2981, **2,5%** ke treasury. Dihormati Element/OpenSea; kalau tidak dihormati, tidak ada paksaan — dan itu dinyatakan terbuka di halaman.

## Fungsi kontrak
```
mint(uint256 qty)            // qty 1..3, bayar sesuai priceFor(msg.sender)
priceFor(address) view       // harga keping berikutnya untuk wallet itu
mintedBy(address) view
freeGranted() view           // berapa keping gratis sudah dipakai (maks 223)
reveal(bytes32 secret)       // sekali, setelah revealBlock
tokenURI(uint256) view
totalMinted() view
MAX_SUPPLY() view
FREE_QUOTA() view
royaltyInfo(uint256,uint256)
```
Tidak ada: `owner`, `pause`, `withdraw`, `setPrice`, `setBaseURI`, `rescue`.

## Keamanan yang diuji
- Gate: wallet tanpa Agent ID → revert
- Batas 3/wallet
- Harga: kirim kurang → revert; kirim lebih → refund sisa
- Kuota gratis: keping ke-3 gratis hanya jika #1 dan #2 sudah dibayar; setelah 223 habis → bayar
- Supply: mint melewati 2.222 → revert
- Reveal: sebelum blok → revert; dua kali → revert; secret salah → revert
- Tidak ada jalur admin (grep fungsi + test "no admin can move funds")
- Reentrancy: hanya ERC721 + transfer BNB keluar (pakai `call` dengan gas terbatas atau `transfer`)
- Royalty sesuai EIP-2981

## Yang tidak ada (sengaja)
- Tidak ada mining/yield — tidak ada janji yang bisa gagal
- Tidak ada pasar bawaan — jual di Element/OpenSea (Lodepass pun tidak pernah punya bid)
- Tidak ada token, tidak ada airdrop

## Rencana kerja
1. Dokumen ini disetujui
2. Tulis kontrak + test (target 20+ test)
3. Uji lokal: harga, kuota, reveal, refund, no-admin
4. Deploy testnet BSC, jalankan satu siklus penuh
5. Deploy mainnet + **verify dalam 30 menit** (butuh API key BscScan)
6. Halaman statis + prompt agent + tabel rarity
7. Announce hanya setelah verified

## Biaya
| pos | BNB |
|---|---|
| Deploy koleksi | 0,0002 |
| Cadangan retry/uji | 0,0002 |
| **Total** | **±0,0004 (~$0,30)** |

## Yang menahan
**API key BscScan (Etherscan V2).** Tanpa itu langkah 5 tidak bisa, dan kita mengulang kesalahan Lodepass (kontrak live tanpa centang hijau).
