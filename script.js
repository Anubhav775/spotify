// smart-player.js - replace your script.js with this
// Features:
// - fetches /songs/ listing (expects directory listing served via local server)
// - shuffles visible .card1 elements
// - matches each card to the best song via token overlap (no hardcoded conditions)
// - popup overlay player + bottom persistent player
// - prev/next autoplays; ended -> next
// - clicking outside popup closes it and shows bottom player
// - progress bars + seek + play/pause sync

// ---------- State ----------
let songsList = [];    // [{name, url}]
let audio = null;
let currentIndex = -1; // index in songsList
let isPlaying = false;
let currentPopup = null;
let bottomPlayer = null;

// ---------- Utilities ----------
function log(...a){ console.log("[player]", ...a); }
function normalize(s=""){ return s.toLowerCase().replace(/[-_\.]/g," ").replace(/\s+/g," ").trim(); }
function words(s=""){ return normalize(s).split(/\s+/).filter(Boolean); }

// Fisher–Yates shuffle
function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Fetch songs ----------
async function getsong(){
  try{
    const res = await fetch("http://127.0.0.1:5500/songs/");
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const div = document.createElement("div");
    div.innerHTML = html;
    const anchors = Array.from(div.getElementsByTagName("a"));
    const songs = anchors
      .map(a => a.href)
      .filter(h => h && h.toLowerCase().endsWith(".mp3"))
      .map(h => {
        const raw = h.split("/").filter(Boolean).pop();
        const name = decodeURIComponent(raw).replace(/\.mp3$/i,"").trim();
        return { name, url: h };
      });

    // unique by url
    const seen = new Set();
    songsList = songs.filter(s => {
      if(seen.has(s.url)) return false;
      seen.add(s.url); return true;
    });
    log("Loaded songs:", songsList.length);
    return songsList;
  }catch(err){
    console.error("Failed to load songs:", err);
    songsList = [];
    return [];
  }
}

// ---------- Card shuffle ----------
function shuffleCardsOnPage(){
  const container = document.querySelector(".card");
  if(!container) return;
  const cards = Array.from(container.querySelectorAll(".card1"));
  const shuffled = shuffleArray(cards.slice());
  shuffled.forEach(c => container.appendChild(c)); // re-append in random order
}

// ---------- Matching (token-overlap) ----------
function bestMatchIndexForCard(cardTitle){
  if(!songsList.length) return -1;
  const cWords = new Set(words(cardTitle));
  let bestIdx = -1, bestScore = -1;
  for(let i=0;i<songsList.length;i++){
    const sWords = new Set(words(songsList[i].name));
    // compute token overlap score: intersection / union
    const intersection = [...cWords].filter(w => sWords.has(w)).length;
    const union = new Set([...cWords, ...sWords]).size || 1;
    const score = intersection / union; // range 0..1
    // small boost if card title is substring of file name or vice versa
    const cNorm = normalize(cardTitle), sNorm = normalize(songsList[i].name);
    if(sNorm.includes(cNorm) || cNorm.includes(sNorm)) {
      // give stronger preference
      if(score + 0.5 > bestScore){ bestScore = score + 0.5; bestIdx = i; }
    } else if(score > bestScore){
      bestScore = score; bestIdx = i;
    }
  }
  // if no meaningful match (score very small) still return bestIdx to enable playing
  return bestIdx;
}

// ---------- Audio controls ----------
function ensureAudio(){
  if(!audio){
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => { playNext(); });
    audio.addEventListener("timeupdate", updateProgressUI);
  }
}

async function playIndex(index){
  if(index < 0 || index >= songsList.length) return;
  ensureAudio();
  currentIndex = index;
  audio.src = songsList[currentIndex].url;
  audio.currentTime = 0;
  try{
    await audio.play();
    isPlaying = true;
    updateAllUI();
  }catch(err){
    console.warn("Play prevented:", err);
  }
}

function playNext(){
  if(!songsList.length) return;
  let nxt = (currentIndex + 1) % songsList.length;
  playIndex(nxt);
}

function playPrev(){
  if(!songsList.length) return;
  let prev = (currentIndex - 1 + songsList.length) % songsList.length;
  playIndex(prev);
}

function togglePlayPause(){
  if(!audio) return;
  if(isPlaying){ audio.pause(); isPlaying=false; }
  else { audio.play().catch(e=>console.warn(e)); isPlaying=true; }
  updateAllUI();
}

function updateProgressUI(){
  const pct = audio && audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
  // popup bar
  if(currentPopup){
    const inner = currentPopup.querySelector(".pp-progress-inner");
    if(inner) inner.style.width = pct + "%";
    const time = currentPopup.querySelector(".pp-time");
    if(time) time.textContent = formatTime(audio.currentTime) + " / " + (audio.duration ? formatTime(audio.duration) : "--:--");
  }
  // bottom bar
  if(bottomPlayer){
    const inner = bottomPlayer.querySelector(".bp-progress-inner");
    if(inner) inner.style.width = pct + "%";
    const time = bottomPlayer.querySelector(".bp-time");
    if(time) time.textContent = formatTime(audio.currentTime) + " / " + (audio.duration ? formatTime(audio.duration) : "--:--");
  }
}

function formatTime(s=0){
  if(!isFinite(s)) return "00:00";
  const m = Math.floor(s/60).toString().padStart(2,"0");
  const sec = Math.floor(s%60).toString().padStart(2,"0");
  return `${m}:${sec}`;
}

function updateAllUI(){
  // highlight current card
  document.querySelectorAll(".card1").forEach(c => c.style.outline = "");
  const curCard = document.querySelector(`.card1[data-song-index="${currentIndex}"]`);
  if(curCard) curCard.style.outline = "2px solid #1DB954";

  // popup play icon
  if(currentPopup){
    const icon = currentPopup.querySelector(".pp-playpause");
    if(icon) icon.textContent = isPlaying ? "pause" : "play_arrow";
    const title = currentPopup.querySelector(".pp-title");
    if(title) title.textContent = songsList[currentIndex] ? songsList[currentIndex].name : "";
    const art = currentPopup.querySelector(".pp-art");
    if(art){
      const sourceCard = document.querySelector(`.card1[data-song-index="${currentIndex}"]`);
      art.src = sourceCard && sourceCard.querySelector("img") ? sourceCard.querySelector("img").src : "";
    }
  }

  // bottom UI
  if(bottomPlayer){
    const icon = bottomPlayer.querySelector(".bp-playpause");
    if(icon) icon.textContent = isPlaying ? "pause" : "play_arrow";
    const title = bottomPlayer.querySelector(".bp-title");
    if(title) title.textContent = songsList[currentIndex] ? songsList[currentIndex].name : "-";
    const art = bottomPlayer.querySelector(".bp-art");
    if(art){
      const sourceCard = document.querySelector(`.card1[data-song-index="${currentIndex}"]`);
      art.src = sourceCard && sourceCard.querySelector("img") ? sourceCard.querySelector("img").src : "";
    }
  }
}

// ---------- Popup (overlay) ----------
function showPopup(cardEl, index){
  // close existing
  closePopup();

  const overlay = document.createElement("div");
  overlay.className = "player-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;";

  const artSrc = cardEl && cardEl.querySelector("img") ? cardEl.querySelector("img").src : "";
  const artistText = cardEl && cardEl.querySelector("p") ? cardEl.querySelector("p").textContent : "";

  const box = document.createElement("div");
  box.className = "popup-box";
  box.style.cssText = "width:420px;max-width:calc(100% - 40px);background:#282828;border-radius:12px;padding:20px;color:white;";

  box.innerHTML = `
    <button class="pp-close" style="position:absolute;right:18px;top:18px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">✕</button>
    <div style="display:flex;flex-direction:column;align-items:center;">
      <img class="pp-art" src="${artSrc}" style="width:220px;height:220px;border-radius:8px;object-fit:cover;margin-bottom:14px;">
      <h3 class="pp-title" style="margin:0 0 6px 0">${songsList[index] ? songsList[index].name : ""}</h3>
      <p class="pp-artist" style="color:#b3b3b3;margin:0 0 14px 0;">${artistText}</p>
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:12px;">
        <button class="pp-prev material-icons" style="background:none;border:none;color:white;font-size:28px;cursor:pointer;">skip_previous</button>
        <button class="pp-playpause material-icons" style="background:#1DB954;border:none;color:white;border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;">${isPlaying ? "pause" : "play_arrow"}</button>
        <button class="pp-next material-icons" style="background:none;border:none;color:white;font-size:28px;cursor:pointer;">skip_next</button>
      </div>
      <div class="pp-progress" style="width:100%;height:6px;background:#404040;border-radius:3px;overflow:hidden;cursor:pointer;">
        <div class="pp-progress-inner" style="width:0%;height:100%;background:#1DB954;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;color:#b3b3b3;font-size:12px;margin-top:8px;">
        <span class="pp-time">00:00 / --:--</span>
        <span>Auto quality</span>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  currentPopup = overlay;

  // overlay click (outside popup) => close popup and show bottom player
  overlay.addEventListener("click", (e) => {
    if(e.target === overlay){
      closePopup();
      showBottomPlayer();
    }
  });

  // close btn
  box.querySelector(".pp-close").addEventListener("click", () => {
    closePopup();
    showBottomPlayer();
  });

  // controls
  box.querySelector(".pp-playpause").addEventListener("click", () => togglePlayPause());
  box.querySelector(".pp-next").addEventListener("click", () => playNext());
  box.querySelector(".pp-prev").addEventListener("click", () => playPrev());

  // progress seeking
  box.querySelector(".pp-progress").addEventListener("click", (ev) => {
    if(!audio || !audio.duration) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const frac = Math.max(0, Math.min(1, x / r.width));
    audio.currentTime = frac * audio.duration;
    updateProgressUI();
  });

  // keyboard
  window.addEventListener("keydown", popupKeyHandler);

  updateAllUI();
  updateProgressUI();
}

function closePopup(){
  if(!currentPopup) return;
  window.removeEventListener("keydown", popupKeyHandler);
  currentPopup.remove();
  currentPopup = null;
}
function popupKeyHandler(e){
  if(e.code === "Space"){
    e.preventDefault();
    togglePlayPause();
  }
}

// ---------- Bottom player ----------
function showBottomPlayer(){
  if(bottomPlayer) return;
  const el = document.createElement("div");
  el.className = "bottom-player";
  el.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;height:72px;background:rgba(24,24,24,0.95);border-radius:10px;padding:10px 14px;display:flex;gap:12px;align-items:center;z-index:9999;color:white;";

  el.innerHTML = `
    <img class="bp-art" src="" style="width:52px;height:52px;border-radius:8px;object-fit:cover;">
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="overflow:hidden;min-width:0;">
          <div class="bp-title" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">-</div>
          <div class="bp-artist" style="font-size:12px;color:#b3b3b3;">-</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="bp-prev material-icons" style="background:none;border:none;color:white;font-size:22px;cursor:pointer;">skip_previous</button>
          <button class="bp-playpause material-icons" style="background:#1DB954;border:none;color:white;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;">${isPlaying ? "pause" : "play_arrow"}</button>
          <button class="bp-next material-icons" style="background:none;border:none;color:white;font-size:22px;cursor:pointer;">skip_next</button>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;">
        <div class="bp-progress" style="flex:1;height:6px;background:#404040;border-radius:3px;overflow:hidden;cursor:pointer;">
          <div class="bp-progress-inner" style="width:0%;height:100%;background:#1DB954;"></div>
        </div>
        <div class="bp-time" style="width:72px;text-align:right;font-size:12px;color:#b3b3b3;">00:00 / --:--</div>
      </div>
    </div>
    <button class="bp-close" title="Close" style="background:none;border:none;color:#b3b3b3;font-size:20px;cursor:pointer;">✕</button>
  `;

  document.body.appendChild(el);
  bottomPlayer = el;

  // attach events
  el.querySelector(".bp-playpause").addEventListener("click", () => togglePlayPause());
  el.querySelector(".bp-next").addEventListener("click", () => playNext());
  el.querySelector(".bp-prev").addEventListener("click", () => playPrev());
  el.querySelector(".bp-close").addEventListener("click", () => { el.remove(); bottomPlayer=null; });

  el.querySelector(".bp-progress").addEventListener("click", (ev) => {
    if(!audio || !audio.duration) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const frac = Math.max(0, Math.min(1, x / r.width));
    audio.currentTime = frac * audio.duration;
    updateProgressUI();
  });

  updateAllUI();
  updateProgressUI();
}

// ---------- Connect cards to songs dynamically ----------
function connectCards(){
  const cards = Array.from(document.querySelectorAll(".card1"));
  if(!cards.length) return;

  // Shuffle DOM cards for random arrangement
  shuffleCardsOnPage();

  const cardsAfterShuffle = Array.from(document.querySelectorAll(".card1"));
  cardsAfterShuffle.forEach(card => {
    const titleEl = card.querySelector("h2");
    if(!titleEl) return;
    const titleText = titleEl.textContent || "";
    const best = bestMatchIndexForCard(titleText);
    card.dataset.songIndex = best; // store mapping
    // click -> set & play + open popup
    card.addEventListener("click", () => {
      if(best >= 0){
        playIndex(best);
        showPopup(card, best);
      }else{
        // no match found (unlikely) - show bottom player only
        showBottomPlayer();
      }
    });
    // keyboard accessibility
    card.setAttribute("tabindex","0");
    card.addEventListener("keydown", (e) => {
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); card.click(); }
    });
  });
}

// ---------- Init ----------
(async function init(){
  await getsong();
  connectCards();
  // optionally, you can show bottom player immediately but hidden:
  // showBottomPlayer(); bottomPlayer && bottomPlayer.remove();
})();

// Expose for debug
window.player = { songsList, playIndex: (i)=>playIndex(i), playNext, playPrev, togglePlayPause };
