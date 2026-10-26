/* Pengupunk Market · Arcade Cabinet
   - book comes from docs/index.json (rebuilt by scripts/index_market.js from events)
   - every price is re-read on-chain before an action, so the JSON is only a directory
   - wallet connect: injected first, WalletConnect fallback, copy-link escape hatch */
(() => {
  const CFG = {
    chainId: 56,
    chainName: "BNB Smart Chain",
    rpc: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
    nft: "0xE2b3D9043fccc76e6Ce13f84346735F1AA375b5a",
    market: "0xa2DcdE14A53d84bf488EB271E19d0bcc3c48A418",
    index: "index.json",
    wcProjectId: "5e2f89a9606073fc5f4e3713925259c7",
  };

  const MARKET_ABI = [
    "function listing(uint256) view returns (address seller, uint96 price, uint64 expiry)",
    "function bestBid(uint256) view returns (address bidder, uint96 amount, uint64 expiry)",
    "function FEE_BPS() view returns (uint256)",
    "function list(uint256 tokenId, uint256 price, uint64 durationDays)",
    "function cancel(uint256 tokenId)",
    "function buy(uint256 tokenId) payable",
    "function bid(uint256 tokenId, uint64 durationDays) payable",
    "function cancelBid(uint256 tokenId)",
    "function acceptBid(uint256 tokenId)",
  ];
  const NFT_ABI = [
    "function tokenURI(uint256) view returns (string)",
    "function ownerOf(uint256) view returns (address)",
    "function totalMinted() view returns (uint256)",
    "function tierOf(uint256) view returns (string)",
    "function getApproved(uint256) view returns (address)",
    "function isApprovedForAll(address,address) view returns (bool)",
    "function approve(address,uint256)",
  ];

  const S = {
    read: null, signer: null, account: null,
    nftRead: null, mktRead: null, nft: null, mkt: null,
    book: null, filter: "asks", art: new Map(), busy: false, justConnected: 0,
  };

  const $ = (id) => document.getElementById(id);
  const short = (a) => (a ? a.slice(0, 5) + "…" + a.slice(-3) : "—");
  const pad = (n) => String(n).padStart(4, "0");
  const fmt = (wei) => {
    if (wei === undefined || wei === null) return "—";
    const n = Number(ethers.formatEther(wei));
    if (n === 0) return "0";
    return n < 0.0001 ? n.toFixed(8).replace(/0+$/, "") : n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  };

  const T = {
    en: {
      connect: "CONNECT", asks: "no asks in the book", bids: "no open bids", mine: "you hold no listed piece",
      buy: "BUY", cancel: "CANCEL", sell: "SELL", bidOn: "BID", list: "LIST", mine_h: "your listings",
      connected: "connected:", copied: "page link copied", pick: "Pick the wallet installed in this browser.",
      needPrice: "Ask price in BNB:", needDays: "Duration in days (1-365):", needBid: "Bid amount in BNB:",
      needId: "Token id to list:", confirmed: "confirm in your wallet…", done: "done",
      foot: "PENGUPUNK · 2% fee · 2.5% royalty",
    },
    id: {
      connect: "CONNECT", asks: "belum ada ask", bids: "belum ada bid", mine: "tidak ada keping lu yang di-list",
      buy: "BELI", cancel: "BATAL", sell: "JUAL", bidOn: "BID", list: "PASANG", mine_h: "listing lu",
      connected: "tersambung:", copied: "link halaman disalin", pick: "Pilih wallet yang terpasang di browser ini.",
      needPrice: "Harga ask (BNB):", needDays: "Durasi hari (1-365):", needBid: "Nilai bid (BNB):",
      needId: "Token id yang mau dipasang:", confirmed: "konfirmasi di wallet…", done: "beres",
      foot: "PENGUPUNK · fee 2% · royalty 2,5%",
    },
    zh: {
      connect: "连接", asks: "暂无卖单", bids: "暂无买单", mine: "你没有上架的藏品",
      buy: "购买", cancel: "取消", sell: "卖出", bidOn: "出价", list: "上架", mine_h: "你的上架",
      connected: "已连接：", copied: "页面链接已复制", pick: "请选择此浏览器中的钱包。",
      needPrice: "卖价（BNB）：", needDays: "天数（1-365）：", needBid: "出价（BNB）：",
      needId: "要上架的 token id：", confirmed: "请在钱包中确认…", done: "完成",
      foot: "PENGUPUNK · 手续费 2% · 版税 2.5%",
    },
  };
  let lang = (() => { try { return localStorage.getItem("pgu.lang") || (navigator.language || "en").slice(0, 2); } catch (e) { return "en"; } })();
  if (!T[lang]) lang = "en";
  const t = (k) => (T[lang] && T[lang][k]) || T.en[k] || k;

  function toast(msg, bad = false) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast on" + (bad ? " bad" : "");
    clearTimeout(el._h);
    el._h = setTimeout(() => (el.className = "toast"), 5200);
  }

  const errText = (e, fb) => String((e && (e.shortMessage || e.reason || e.message)) || fb).slice(0, 140);

  function artFor(id) {
    if (S.art.has(id)) return Promise.resolve(S.art.get(id));
    return S.nftRead.tokenURI(id).then((uri) => {
      const json = JSON.parse(atob(uri.split(",")[1]));
      const svg = atob(json.image.split(",")[1]);
      const img = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      S.art.set(id, img);
      return img;
    }).catch(() => null);
  }

  // ---------------------------------------------------------------- data
  async function boot() {
    S.read = new ethers.JsonRpcProvider(CFG.rpc, CFG.chainId, { staticNetwork: true });
    S.nftRead = new ethers.Contract(CFG.nft, NFT_ABI, S.read);
    S.mktRead = new ethers.Contract(CFG.market, MARKET_ABI, S.read);
    $("mkLink").href = `${CFG.explorer}/address/${CFG.market}`;
    $("nftLink").href = `${CFG.explorer}/address/${CFG.nft}`;
    applyLang(lang);
    await loadBook();
    setInterval(loadBook, 60000);
  }

  async function loadBook() {
    try {
      const r = await fetch(CFG.index + "?t=" + Date.now(), { cache: "no-store" });
      const book = await r.json();
      S.book = book;
      $("hMinted").innerHTML = `${book.totalMinted} <small>/ 2222</small>`;
      $("hFloor").innerHTML = book.floor && book.floor !== "0" ? `${fmt(book.floor)} <small>BNB</small>` : "—";
      $("hAsks").textContent = book.listings.length;
      $("hBids").textContent = book.bids.length;
      $("hSales").textContent = book.sales === null || book.sales === undefined ? "—" : book.sales;
      $("hFeed").textContent = book.updatedAt ? new Date(book.updatedAt).toISOString().slice(11, 16) + "Z" : "—";
      await render();
    } catch (e) {
      toast("index.json belum siap — jalankan indexer", true);
      $("grid").innerHTML = `<div class="empty">book unavailable</div>`;
    }
  }

  async function render() {
    const b = S.book;
    if (!b) return;
    if (S.filter === "asks") return renderListings(b.listings, "ask");
    if (S.filter === "bids") return renderBids(b.bids);
    return renderMine(b);
  }

  async function renderListings(items, kind) {
    if (!items.length) { $("grid").innerHTML = `<div class="empty">${t("asks")}</div>`; return; }
    const cards = [];
    for (const l of items.slice(0, 36)) {
      const art = await artFor(l.id);
      const mine = S.account && l.seller.toLowerCase() === S.account.toLowerCase();
      const tier = (b_tier(l.id) || "").toLowerCase();
      cards.push(`<div class="tile">
        <div class="art">${art ? `<img src="${art}" alt="">` : ""}<span class="wtag">${tier || "ask"}</span></div>
        <div class="body">
          <div class="row"><span class="id">#${pad(l.id)}</span><span class="price">${fmt(l.price)} BNB</span></div>
          <div class="who">${short(l.seller)}${mine ? " · you" : ""}</div>
          <div class="acts">${
            mine
              ? `<button class="coin cyan" data-act="cancel" data-id="${l.id}">${t("cancel")}</button>`
              : `<button class="coin solid" data-act="buy" data-id="${l.id}" data-price="${l.price}">${t("buy")}</button>
                 <button class="coin cyan" data-act="bid" data-id="${l.id}">${t("bidOn")}</button>`
          }</div>
        </div>
      </div>`);
    }
    const perRow = window.innerWidth > 1000 ? 4 : window.innerWidth > 720 ? 3 : 2;
    const padTo = Math.ceil(cards.length / perRow) * perRow - cards.length;
    $("grid").innerHTML = cards.join("") + slots(Math.min(padTo, 3));
  }

  function slots(n) {
    return Array.from({ length: n }, () => `<div class="slot"><span>empty slot</span></div>`).join("");
  }

  function b_tier(id) { return S.book && S.book.tiers ? S.book.tiers[id] : ""; }

  async function renderBids(items) {
    if (!items.length) { $("grid").innerHTML = `<div class="empty">${t("bids")}</div>`; return; }
    const cards = [];
    for (const b of items.slice(0, 36)) {
      const art = await artFor(b.id);
      cards.push(`<div class="tile">
        <div class="art">${art ? `<img src="${art}" alt="">` : ""}<span class="wtag">bid</span></div>
        <div class="body">
          <div class="row"><span class="id">#${pad(b.id)}</span><span class="price">${fmt(b.amount)} BNB</span></div>
          <div class="who">${short(b.bidder)}</div>
          <div class="acts">
            <button class="coin solid" data-act="accept" data-id="${b.id}">${t("sell")}</button>
            <button class="coin cyan" data-act="cancelBid" data-id="${b.id}">${t("cancel")}</button>
          </div>
        </div>
      </div>`);
    }
    const perRow = window.innerWidth > 1000 ? 4 : window.innerWidth > 720 ? 3 : 2;
    const padTo = Math.ceil(cards.length / perRow) * perRow - cards.length;
    $("grid").innerHTML = cards.join("") + slots(Math.min(padTo, 3));
  }

  async function renderMine(b) {
    const mine = b.listings.filter((l) => S.account && l.seller.toLowerCase() === S.account.toLowerCase());
    const head = `<div class="empty" style="border-style:solid">
        <div style="margin-bottom:10px">${t("mine_h")}</div>
        <button class="coin cyan" data-act="newlist">${t("list")} +</button>
      </div>`;
    if (!mine.length) { $("grid").innerHTML = head + `<div class="empty">${t("mine")}</div>`; return; }
    await renderListings(mine, "ask");
    $("grid").insertAdjacentHTML("afterbegin", `<div class="empty" style="border-style:solid;grid-column:1/-1">
      ${t("mine_h")} · <button class="coin cyan" data-act="newlist">${t("list")} +</button></div>`);
  }

  // -------------------------------------------------------------- wallet
  const hasInjected = () => Boolean(window.ethereum);

  function openSheet() {
    const url = location.href.split("#")[0];
    const opts = [
      {
        nm: hasInjected() ? "Wallet in this browser" : "Wallet in this browser (none found)",
        nt: hasInjected() ? "READY · tap here" : "—",
        fn: async () => {
          if (hasInjected()) return connectInjected();
          await copyText(url);
          toast(t("pick"), true);
        },
      },
      { nm: "WalletConnect", nt: "QR · desktop or second phone", fn: () => connectWC() },
      { nm: "Copy page link", nt: "—", fn: async () => { await copyText(url); toast(t("copied")); } },
    ];
    $("sheetList").innerHTML = opts.map((o, i) =>
      `<div class="wrow${i === 0 && hasInjected() ? " hot" : ""}" data-i="${i}">
         <span class="dot"></span><span class="nm">${o.nm}</span><span class="nt">${o.nt}</span></div>`).join("");
    $("sheet").classList.add("on");
    $("sheetList").querySelectorAll(".wrow").forEach((el) => {
      el.onclick = async () => {
        try { await opts[Number(el.dataset.i)].fn(); }
        catch (e) {
          const m = String((e && e.message) || "");
          if (/reset|closed|session/i.test(m)) { toast("connection closed — try again"); return; }
          if (/rejected/i.test(m)) return;
          toast(errText(e, "connect failed"), true);
        }
      };
    });
  }
  const closeSheet = () => $("sheet").classList.remove("on");

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (err) {}
      document.body.removeChild(ta);
    }
  }

  async function connectInjected() {
    if (!window.ethereum) throw new Error("no wallet in this browser");
    toast("opening wallet…");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) throw new Error("no account");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CFG.chainId) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + CFG.chainId.toString(16) }] });
      } catch (e) { throw new Error("switch network to BNB Smart Chain first"); }
    }
    const signer = await provider.getSigner();
    attach(signer, accounts[0]);
    window.ethereum.on?.("accountsChanged", (a) => { if (!a || !a.length) softOff(); });
    window.ethereum.on?.("chainChanged", (hex) => {
      const id = parseInt(hex, 16);
      if (Number.isFinite(id) && id !== CFG.chainId) location.reload();
    });
    window.ethereum.on?.("disconnect", () => softOff());
  }

  async function connectWC() {
    toast("opening wallet…");
    const mod = await import("https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.21.0/+esm");
    const Eth = mod.EthereumProvider || mod.default;
    const wc = await Eth.init({
      projectId: CFG.wcProjectId,
      chains: [CFG.chainId],
      optionalChains: [CFG.chainId],
      showQrModal: true,
      metadata: { name: "Pengupunk Market", description: "asks and bids", url: location.origin, icons: [] },
    });
    await wc.connect();
    const provider = new ethers.BrowserProvider(wc);
    const signer = await provider.getSigner();
    attach(signer, await signer.getAddress());
    wc.on?.("disconnect", () => softOff());
  }

  function attach(signer, address) {
    S.signer = signer;
    S.account = ethers.getAddress(address);
    S.justConnected = Date.now();
    S.nft = new ethers.Contract(CFG.nft, NFT_ABI, signer);
    S.mkt = new ethers.Contract(CFG.market, MARKET_ABI, signer);
    const b = $("walletBtn");
    b.textContent = short(S.account);
    b.classList.add("solid");
    closeSheet();
    toast(t("connected") + " " + short(S.account));
    render();
  }

  function softOff() {
    toast("wallet reported a disconnect — tap CONNECT again", true);
    const b = $("walletBtn");
    b.textContent = t("connect");
    b.classList.remove("solid");
  }

  // ------------------------------------------------------------- actions
  async function priceNow(id) {
    const l = await S.mktRead.listing(id);
    return { seller: l[0], price: l[1], expiry: Number(l[2]) };
  }

  async function buy(id, priceAttr) {
    if (!S.account) return openSheet();
    if (Date.now() - S.justConnected < 2500) return;
    try {
      const l = await priceNow(id);
      if (l.seller === ethers.ZeroAddress) throw new Error("no longer listed");
      const tx = await S.mkt.buy(id, { value: l.price });
      toast(t("confirmed"));
      await tx.wait();
      toast("sold · " + short(tx.hash));
      loadBook();
    } catch (e) { toast(errText(e, "buy failed"), true); }
  }

  async function cancel(id) {
    try {
      const tx = await S.mkt.cancel(id);
      await tx.wait();
      toast("listing cancelled");
      loadBook();
    } catch (e) { toast(errText(e, "cancel failed"), true); }
  }

  async function bidOn(id) {
    if (!S.account) return openSheet();
    const amt = prompt(t("needBid"), "0.001");
    if (!amt) return;
    const days = prompt(t("needDays"), "7");
    if (!days) return;
    try {
      const tx = await S.mkt.bid(id, Number(days), { value: ethers.parseEther(amt) });
      await tx.wait();
      toast("bid active — funds escrowed");
      loadBook();
    } catch (e) { toast(errText(e, "bid failed"), true); }
  }

  async function accept(id) {
    if (!S.account) return openSheet();
    try {
      const approved = await S.nft.getApproved(id);
      if (approved.toLowerCase() !== CFG.market.toLowerCase()) {
        toast("approve the piece first…");
        await (await S.nft.approve(CFG.market, id)).wait();
      }
      const tx = await S.mkt.acceptBid(id);
      await tx.wait();
      toast("sold into bid");
      loadBook();
    } catch (e) { toast(errText(e, "accept failed"), true); }
  }

  async function cancelBid(id) {
    try {
      const tx = await S.mkt.cancelBid(id);
      await tx.wait();
      toast("bid cancelled");
      loadBook();
    } catch (e) { toast(errText(e, "cancel failed"), true); }
  }

  async function newListing() {
    if (!S.account) return openSheet();
    const idRaw = prompt(t("needId"), "");
    if (!idRaw) return;
    const id = Number(idRaw.trim());
    const price = prompt(t("needPrice"), "0.001");
    if (!price) return;
    const days = prompt(t("needDays"), "7");
    if (!days) return;
    try {
      const owner = await S.nftRead.ownerOf(id);
      if (owner.toLowerCase() !== S.account.toLowerCase()) throw new Error("you do not own that token id");
      const approved = await S.nft.getApproved(id);
      if (approved.toLowerCase() !== CFG.market.toLowerCase()) {
        toast("approving…");
        await (await S.nft.approve(CFG.market, id)).wait();
      }
      const tx = await S.mkt.list(id, ethers.parseEther(price), Number(days));
      await tx.wait();
      toast("listed");
      loadBook();
    } catch (e) { toast(errText(e, "list failed"), true); }
  }

  // -------------------------------------------------------------- wiring
  function applyLang(l) {
    lang = T[l] ? l : "en";
    try { localStorage.setItem("pgu.lang", lang); } catch (e) {}
    document.documentElement.lang = lang;
    $("walletBtn").textContent = S.account ? short(S.account) : t("connect");
    $("sheetHint").textContent = t("pick");
    document.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("solid", b.dataset.lang === lang));
    render();
  }

  document.addEventListener("click", (e) => {
    if (e.target.id === "walletBtn") return openSheet();
    if (e.target.id === "sheetClose" || e.target.id === "sheet") return closeSheet();
    const langBtn = e.target.closest("[data-lang]");
    if (langBtn) return applyLang(langBtn.dataset.lang);
    const tab = e.target.closest("[data-filter]");
    if (tab) {
      S.filter = tab.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("on", x === tab));
      return render();
    }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const id = Number(a.dataset.id);
    const act = a.dataset.act;
    if (act === "buy") return buy(id, a.dataset.price);
    if (act === "cancel") return cancel(id);
    if (act === "bid") return bidOn(id);
    if (act === "accept") return accept(id);
    if (act === "cancelBid") return cancelBid(id);
    if (act === "newlist") return newListing();
  });

  window.addEventListener("load", boot);
})();
