import { firebaseConfig, isConfigured, FB } from './firebase-config.js';

const $ = id => document.getElementById(id);
const LIMITS = { projects: 3, photos: 15, members: 20 };

// ---- mobile menu
const mb = $('mb'), ln = document.querySelector('.links');
mb.onclick = () => { const o = ln.classList.toggle('on'); mb.setAttribute('aria-expanded', o); };
ln.onclick = e => { if (e.target.closest('a')) ln.classList.remove('on'); };

// ---- scroll reveal
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); setTimeout(() => e.target.style.transitionDelay = '', 1000); }
}), { threshold: 0.12 }) : null;
function reveal() {
  document.querySelectorAll('h2,.v,.p,.work li,.motto,.goal,.tag,.ct>div,.gal button,.pj,.ev,.more,section p').forEach((el, i) => {
    if (el.classList.contains('rv')) return;
    el.classList.add('rv'); el.style.transitionDelay = (i % 4) * 80 + 'ms';
    io ? io.observe(el) : el.classList.add('in');
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moreBtn = (id, rest) => { $(id).innerHTML = rest > 0 ? `<button class="btn vm" type="button">View more (${rest})</button>` : ''; };

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

// ---- team (founders: all, members: first 20 + View more)
let MEM = [];
function renderMembers(list, all) {
  if (list) MEM = [...list].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const f = MEM.filter(m => m.type === 'founder'), m = MEM.filter(x => x.type !== 'founder');
  const shown = all ? m : m.slice(0, LIMITS.members);
  $('founders').innerHTML = f.map(x => `<div class="p"><h3>${esc(x.name)}</h3>${x.role ? `<span>${esc(x.role)}</span>` : ''}</div>`).join('');
  $('members').innerHTML = shown.map(x => `<div class="p m"><h3>${esc(x.name)}</h3></div>`).join('');
  $('mh').style.display = m.length ? '' : 'none';
  moreBtn('more-members', all ? 0 : m.length - shown.length);
  reveal();
}
$('more-members').onclick = e => { if (e.target.closest('button')) renderMembers(null, true); };

// ---- gallery (first 15 + View more) and lightbox
let photos = [], cur = 0;
const lb = $('lb'), li = lb.querySelector('img'), cap = lb.querySelector('figcaption');
function show(i) { lb.classList.remove('single'); cur = (i + photos.length) % photos.length; li.src = photos[cur].data; li.alt = photos[cur].caption || 'Gallery photo'; cap.textContent = photos[cur].caption || ''; lb.classList.add('on'); }
function renderGallery(list, all) {
  if (list) photos = list;
  const g = $('gal');
  if (!photos.length) { g.innerHTML = '<p class="empty">Photos coming soon.</p>'; moreBtn('more-gal', 0); reveal(); return; }
  const shown = all ? photos : photos.slice(0, LIMITS.photos);
  g.innerHTML = shown.map((p, i) => `<button class="${i % 7 === 0 ? 'w t' : i % 7 === 3 ? 'w' : ''}" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${p.data}" alt="${esc(p.caption || 'Gallery photo')}" loading="lazy"></button>`).join('');
  moreBtn('more-gal', all ? 0 : photos.length - shown.length);
  reveal();
}
$('gal').onclick = e => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };
$('more-gal').onclick = e => { if (e.target.closest('button')) renderGallery(null, true); };
lb.querySelector('.x').onclick = () => lb.classList.remove('on');
lb.querySelector('.pv').onclick = e => { e.stopPropagation(); show(cur - 1); };
lb.querySelector('.nx').onclick = e => { e.stopPropagation(); show(cur + 1); };
lb.onclick = e => { if (e.target === lb) lb.classList.remove('on'); };
document.addEventListener('keydown', e => {
  if (!lb.classList.contains('on')) return;
  if (e.key === 'Escape') lb.classList.remove('on');
  if (lb.classList.contains('single')) return;
  if (e.key === 'ArrowLeft') show(cur - 1);
  if (e.key === 'ArrowRight') show(cur + 1);
});

// ---- upcoming programmes & events, valuable members, supporters & partners
let EV = [];
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);
function renderEvents(list) {
  EV = list;
  const g = $('evs');
  if (!list.length) { g.innerHTML = '<p class="empty">Upcoming programmes will be announced here soon. Stay tuned!</p>'; reveal(); return; }
  g.innerHTML = list.map((x, i) => `<article class="ev"><img src="${x.poster}" alt="${esc(x.title)} poster" data-i="${i}" loading="lazy"><div class="evb"><h3>${esc(x.title)}</h3>${x.desc ? `<p>${esc(x.desc)}</p>` : ''}${safeUrl(x.youtube) ? `<a class="btn yt" href="${esc(safeUrl(x.youtube))}" target="_blank" rel="noopener">Watch on YouTube</a>` : ''}</div></article>`).join('');
  reveal();
}
$('evs').onclick = e => {
  const im = e.target.closest('img[data-i]'); if (!im) return;
  const x = EV[+im.dataset.i]; li.src = x.poster; li.alt = x.title; cap.textContent = x.title;
  lb.classList.add('single', 'on');
};
function renderValued(list) {
  const l = [...list].sort(byOrder); $('valued').hidden = !l.length;
  $('vm').innerHTML = l.map(x => `<div class="p m"><h3>${esc(x.name)}</h3></div>`).join(''); reveal();
}
function renderPartners(list) {
  const l = [...list].sort(byOrder); $('partners').hidden = !l.length;
  $('pts').innerHTML = l.map(x => `<div class="p"><h3>${esc(x.name)}</h3>${x.company ? `<span>${esc(x.company)}</span>` : ''}</div>`).join(''); reveal();
}

// ---- past projects (first 3 + View more). PDFs are stored in pieces in Firestore and joined on click.
let fsApi = null, PJ = [];
function renderProjects(list, all) {
  if (list) PJ = list;
  const g = $('projs');
  if (!PJ.length) { g.innerHTML = '<p class="empty">Project reports coming soon.</p>'; moreBtn('more-projs', 0); reveal(); return; }
  const shown = all ? PJ : PJ.slice(0, LIMITS.projects);
  g.innerHTML = shown.map(p => `<button class="pj" data-id="${esc(p.id)}"><span class="pdf">PDF</span><span class="pt">${esc(p.title)}</span>${p.date ? `<span class="pd">${esc(p.date)}</span>` : ''}${p.desc ? `<span class="pc">${esc(p.desc)}</span>` : ''}<span class="go">View PDF →</span></button>`).join('');
  moreBtn('more-projs', all ? 0 : PJ.length - shown.length);
  reveal();
}
async function openPdf(id) {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font:18px sans-serif;padding:24px">Loading PDF…</p>');
  try {
    const { db, collection, getDocs } = fsApi;
    const snap = await getDocs(collection(db, 'projects', id, 'chunks'));
    const parts = snap.docs.map(d => d.data()).sort((a, b) => a.i - b.i).map(c => Uint8Array.from(atob(c.d), ch => ch.charCodeAt(0)));
    if (!parts.length) throw new Error('empty');
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/pdf' }));
    if (w) w.location.href = url; else location.href = url;
  } catch (err) {
    console.error(err); if (w) w.close(); alert('Could not open the PDF. Please try again.');
  }
}
$('projs').onclick = e => { const b = e.target.closest('.pj'); if (b && fsApi) openPdf(b.dataset.id); };
$('more-projs').onclick = e => { if (e.target.closest('button')) renderProjects(null, true); };

// ---- load data from Firebase (falls back to defaults if not set up / offline)
async function load() {
  if (!isConfigured) { renderMembers(DEFAULT_MEMBERS); renderGallery([]); renderProjects([]); renderEvents([]); renderValued([]); renderPartners([]); return; }
  try {
    const { initializeApp } = await import(FB + 'firebase-app.js');
    const { getFirestore, collection, getDocs, addDoc, serverTimestamp } = await import(FB + 'firebase-firestore.js');
    const db = getFirestore(initializeApp(firebaseConfig));
    fsApi = { db, collection, getDocs, addDoc, serverTimestamp };
    const opt = n => getDocs(collection(db, n)).catch(() => ({ docs: [] }));
    const [ms, gs, ps, es, vs, pt] = await Promise.all([
      getDocs(collection(db, 'members')), getDocs(collection(db, 'gallery')),
      opt('projects'), opt('events'), opt('vmembers'), opt('partners')
    ]);
    renderEvents(es.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
    renderValued(vs.docs.map(d => d.data())); renderPartners(pt.docs.map(d => d.data()));
    renderProjects(ps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
    const members = ms.docs.map(d => d.data());
    renderMembers(members.length ? members : DEFAULT_MEMBERS);
    renderGallery(gs.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
  } catch (err) {
    console.error(err);
    renderMembers(DEFAULT_MEMBERS); renderGallery([]); renderProjects([]); renderEvents([]); renderValued([]); renderPartners([]);
  }
}

// ---- private suggestion box (saved in Firestore, visible only in the admin panel)
const sx = $('sx');
const note = (t, bad) => { sx.textContent = t; sx.className = 'sx' + (bad ? ' bad' : ' ok'); };
$('sf').onsubmit = async e => {
  e.preventDefault();
  if ($('hp').value) { note('Thank you! Your suggestion has been sent.'); return; } // bots fill the hidden field
  const message = $('sm').value.trim();
  if (message.length < 3) return note('Please write your suggestion first.', true);
  try { if (Date.now() - (+localStorage.getItem('haf_sug') || 0) < 30000) return note('Please wait a little before sending another one.', true); } catch (_) {}
  $('sb').disabled = true; note('Sending…');
  try {
    await ready;
    if (!fsApi) throw new Error('not ready');
    await fsApi.addDoc(fsApi.collection(fsApi.db, 'suggestions'), { name: $('sn').value.trim(), contact: $('sc').value.trim(), message, createdAt: fsApi.serverTimestamp() });
    $('sf').reset(); note('Thank you! Your suggestion has been sent privately to our team.');
    try { localStorage.setItem('haf_sug', String(Date.now())); } catch (_) {}
  } catch (err) {
    console.error(err); note('Sorry, could not send right now. Please try again later.', true);
  }
  $('sb').disabled = false;
};

reveal();
const ready = load();
