import { firebaseConfig, isConfigured, FB } from './firebase-config.js';

// ---- mobile menu
const mb = document.getElementById('mb'), ln = document.querySelector('.links');
mb.onclick = () => { const o = ln.classList.toggle('on'); mb.setAttribute('aria-expanded', o); };
ln.onclick = e => { if (e.target.tagName === 'A') ln.classList.remove('on'); };

// ---- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// shown until you add your own from the admin panel
const DEFAULT_MEMBERS = [
  { name: 'Aqib Rashid', role: 'President', type: 'founder', order: 1 },
  { name: 'Mohammed Asif', role: 'Secretary', type: 'founder', order: 2 },
  { name: 'Md Safee Khan', role: 'Treasurer', type: 'founder', order: 3 },
  { name: 'Mahtab Rashid', type: 'member', order: 4 },
  { name: 'Mohammad Owais', type: 'member', order: 5 },
  { name: 'Akhtar Ali', type: 'member', order: 6 },
  { name: 'Shadab Shams', type: 'member', order: 7 }
];

function renderMembers(list) {
  const sorted = [...list].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const f = sorted.filter(m => m.type === 'founder'), m = sorted.filter(x => x.type !== 'founder');
  document.getElementById('founders').innerHTML = f.map(x => `<div class="p"><h3>${esc(x.name)}</h3>${x.role ? `<span>${esc(x.role)}</span>` : ''}</div>`).join('');
  document.getElementById('members').innerHTML = m.map(x => `<div class="p m"><h3>${esc(x.name)}</h3></div>`).join('');
  document.getElementById('mh').style.display = m.length ? '' : 'none';
}

// ---- gallery + lightbox
let photos = [], cur = 0;
const lb = document.getElementById('lb'), li = lb.querySelector('img'), cap = lb.querySelector('figcaption');
function show(i) { cur = (i + photos.length) % photos.length; li.src = photos[cur].data; li.alt = photos[cur].caption || 'Gallery photo'; cap.textContent = photos[cur].caption || ''; lb.classList.add('on'); }
function renderGallery(list) {
  photos = list;
  const g = document.getElementById('gal');
  if (!list.length) { g.innerHTML = '<p class="empty">Photos coming soon.</p>'; return; }
  g.innerHTML = list.map((p, i) => `<button class="${i % 7 === 0 ? 'w t' : i % 7 === 3 ? 'w' : ''}" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${p.data}" alt="${esc(p.caption || 'Gallery photo')}" loading="lazy"></button>`).join('');
}
document.getElementById('gal').onclick = e => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };
lb.querySelector('.x').onclick = () => lb.classList.remove('on');
lb.querySelector('.pv').onclick = e => { e.stopPropagation(); show(cur - 1); };
lb.querySelector('.nx').onclick = e => { e.stopPropagation(); show(cur + 1); };
lb.onclick = e => { if (e.target === lb) lb.classList.remove('on'); };
document.addEventListener('keydown', e => {
  if (!lb.classList.contains('on')) return;
  if (e.key === 'Escape') lb.classList.remove('on');
  if (e.key === 'ArrowLeft') show(cur - 1);
  if (e.key === 'ArrowRight') show(cur + 1);
});

// ---- load data from Firebase (falls back to defaults if not set up / offline)
async function load() {
  if (!isConfigured) { renderMembers(DEFAULT_MEMBERS); renderGallery([]); return; }
  try {
    const { initializeApp } = await import(FB + 'firebase-app.js');
    const { getFirestore, collection, getDocs } = await import(FB + 'firebase-firestore.js');
    const db = getFirestore(initializeApp(firebaseConfig));
    const [ms, gs] = await Promise.all([getDocs(collection(db, 'members')), getDocs(collection(db, 'gallery'))]);
    const members = ms.docs.map(d => d.data());
    renderMembers(members.length ? members : DEFAULT_MEMBERS);
    renderGallery(gs.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
  } catch (err) {
    console.error(err);
    renderMembers(DEFAULT_MEMBERS); renderGallery([]);
  }
}
load();
