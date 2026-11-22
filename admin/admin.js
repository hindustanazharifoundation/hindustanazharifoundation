import { firebaseConfig, isConfigured, FB } from '../firebase-config.js';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = (id, t, err) => { const e = $(id); e.textContent = t; e.classList.toggle('err', !!err); };

// ---- password gate (stored as a SHA-256 hash, not plain text)
const PASS_HASH = '255ae9046a60af557aff05dee4fc59f6394e01235225d4ed88fc931641755ef9';
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
let started = false;
function unlock() {
  $('login').hidden = true; $('app').hidden = false;
  if (!isConfigured) { $('cfgwarn').hidden = false; return; }
  if (!started) { started = true; init(); }
}
async function tryLogin() {
  say('lmsg', '');
  if (await sha($('pw').value) === PASS_HASH) {
    try { sessionStorage.setItem('haf_admin', '1'); } catch (e) {}
    $('pw').value = ''; unlock();
  } else say('lmsg', 'Wrong password.', true);
}
$('go').onclick = tryLogin;
$('pw').onkeydown = e => { if (e.key === 'Enter') tryLogin(); };
$('out').onclick = () => { try { sessionStorage.removeItem('haf_admin'); } catch (e) {} location.reload(); };
try { if (sessionStorage.getItem('haf_admin') === '1') unlock(); } catch (e) {}

async function init() {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const fs = await import(FB + 'firebase-firestore.js');
  const { getFirestore, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, doc, serverTimestamp } = fs;
  const db = getFirestore(initializeApp(firebaseConfig));

  loadPhotos(); loadMembers(); loadProjects();
  loadSug();
  async function loadSug() {
    say('smsg', '');
    try {
      const s = await getDocs(collection(db, 'suggestions'));
      const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9));
      $('slist').innerHTML = l.length ? l.map(x => `<div class="sg" data-id="${x.id}"><small>${x.createdAt ? new Date(x.createdAt.seconds * 1000).toLocaleString('en-IN') : ''} · ${esc(x.name) || 'Anonymous'}${x.contact ? ' · ' + esc(x.contact) : ''}</small><p>${esc(x.message)}</p><button class="b s d" data-sdel>Delete</button></div>`).join('') : '<p class="mut">No suggestions yet.</p>';
    } catch (e) { console.error(e); say('smsg', 'Could not load suggestions. Publish the latest firestore.rules and refresh.', true); }
  }
  $('slist').onclick = async e => {
    const row = e.target.closest('.sg'); if (!row || !e.target.hasAttribute('data-sdel') || !confirm('Delete this suggestion?')) return;
    await deleteDoc(doc(db, 'suggestions', row.dataset.id)); loadSug();
  };

  // ---- tabs
  document.querySelectorAll('.t').forEach(b => b.onclick = () => {
    document.querySelectorAll('.t').forEach(x => x.classList.toggle('on', x === b));
    ['ph', 'mem', 'proj', 'sug'].forEach(id => $(id).hidden = id !== b.dataset.t);
  });

  // ---- photos: shrink in the browser, store inside Firestore (no paid Storage plan needed)
  function shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        let max = 1400, q = 0.8, out;
        for (let i = 0; i < 8; i++) {
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', q);
          if (out.length < 800000) break;
          max *= 0.8; q = Math.max(0.5, q - 0.05);
        }
        URL.revokeObjectURL(url);
        out.length < 950000 ? res(out) : rej(new Error('too big'));
      };
      img.onerror = () => rej(new Error('not an image'));
      img.src = url;
    });
  }
  $('up').onclick = async () => {
    const files = [...$('files').files];
    if (!files.length) return say('umsg', 'Choose at least one photo.', true);
    $('up').disabled = true; let ok = 0;
    for (const [i, f] of files.entries()) {
      say('umsg', `Uploading ${i + 1} of ${files.length}…`);
      try {
        const data = await shrink(f);
        await addDoc(collection(db, 'gallery'), { data, caption: $('capt').value.trim(), createdAt: serverTimestamp() });
        ok++;
      } catch (e) { console.error(e); say('umsg', `Could not upload "${f.name}": ${e.message}`, true); }
    }
    $('up').disabled = false; $('files').value = ''; $('capt').value = '';
    if (ok === files.length) say('umsg', `Done. ${ok} photo(s) uploaded.`);
    loadPhotos();
  };
  async function loadPhotos() {
    const s = await getDocs(collection(db, 'gallery'));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9));
    $('plist').innerHTML = l.length ? l.map(p => `<div class="ph"><img src="${p.data}" alt=""><div>${esc(p.caption) || '&nbsp;'}<button class="b d" data-del="${p.id}">Delete</button></div></div>`).join('') : '<p class="mut">No photos yet.</p>';
  }
  $('plist').onclick = async e => {
    const id = e.target.dataset.del; if (!id || !confirm('Delete this photo from the site?')) return;
    await deleteDoc(doc(db, 'gallery', id)); loadPhotos();
  };

  // ---- projects (PDF split into 600 KB pieces, stored in Firestore)
  const CHUNK = 600000, MAXPDF = 10 * 1024 * 1024;
  const readB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  async function wipeChunks(id) {
    const s = await getDocs(collection(db, 'projects', id, 'chunks'));
    for (const d of s.docs) await deleteDoc(d.ref);
  }
  $('pup').onclick = async () => {
    const title = $('pn').value.trim(), f = $('pf').files[0];
    if (!title) return say('pmsg', 'Enter the project name.', true);
    if (!f) return say('pmsg', 'Choose a PDF file.', true);
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return say('pmsg', 'Only PDF files are allowed.', true);
    if (f.size > MAXPDF) return say('pmsg', `This PDF is ${mb(f.size)}. Please compress it below 10 MB (ilovepdf.com / smallpdf.com) and try again.`, true);
    $('pup').disabled = true;
    const ref = doc(collection(db, 'projects')), n = Math.ceil(f.size / CHUNK);
    try {
      for (let i = 0; i < n; i++) {
        say('pmsg', `Uploading part ${i + 1} of ${n}…`);
        const d = await readB64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        await setDoc(doc(db, 'projects', ref.id, 'chunks', String(i).padStart(3, '0')), { i, d });
      }
      await setDoc(ref, { title, date: $('pdt').value.trim(), desc: $('pds').value.trim(), fileName: f.name, size: f.size, chunks: n, createdAt: serverTimestamp() });
      $('pn').value = ''; $('pdt').value = ''; $('pds').value = ''; $('pf').value = '';
      say('pmsg', 'Done. Project added to the site.');
    } catch (e) {
      console.error(e); try { await wipeChunks(ref.id); } catch (_) {}
      say('pmsg', 'Upload failed. Check your internet and Firestore rules, then try again.', true);
    }
    $('pup').disabled = false; loadProjects();
  };
  async function loadProjects() {
    const s = await getDocs(collection(db, 'projects'));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9));
    $('pjlist').innerHTML = l.length ? l.map(p => `<div class="pjrow" data-id="${p.id}"><div class="row">
      <input class="pt" value="${esc(p.title)}" aria-label="Project name"><input class="pdt" value="${esc(p.date)}" placeholder="Date" aria-label="Date">
      <button class="b s" data-psave>Save</button><button class="b s d" data-prm>Delete</button></div>
      <input class="pds" value="${esc(p.desc)}" placeholder="Short description" aria-label="Description"><small>${esc(p.fileName)} · ${mb(p.size || 0)}</small></div>`).join('') : '<p class="mut">No projects yet.</p>';
  }
  $('pjlist').onclick = async e => {
    const row = e.target.closest('.pjrow'); if (!row) return; const id = row.dataset.id;
    if (e.target.hasAttribute('data-psave')) {
      await updateDoc(doc(db, 'projects', id), { title: row.querySelector('.pt').value.trim(), date: row.querySelector('.pdt').value.trim(), desc: row.querySelector('.pds').value.trim() });
      say('pmsg', 'Saved.'); loadProjects();
    } else if (e.target.hasAttribute('data-prm') && confirm('Delete this project and its PDF?')) {
      say('pmsg', 'Deleting…'); await wipeChunks(id); await deleteDoc(doc(db, 'projects', id)); say('pmsg', 'Deleted.'); loadProjects();
    }
  };

  // ---- members
  const DEFAULTS = [
    ['Aqib Rashid', 'founder', 'President', 1], ['Mohammed Asif', 'founder', 'Secretary', 2], ['Md Safee Khan', 'founder', 'Treasurer', 3],
    ['Mahtab Rashid', 'member', '', 4], ['Mohammad Owais', 'member', '', 5], ['Akhtar Ali', 'member', '', 6], ['Shadab Shams', 'member', '', 7]
  ];
  const rowHtml = m => `<div class="mrow" data-id="${m.id}"><div class="row">
    <input class="n" value="${esc(m.name)}" aria-label="Name">
    <select class="t2"><option value="member"${m.type !== 'founder' ? ' selected' : ''}>Member</option><option value="founder"${m.type === 'founder' ? ' selected' : ''}>Founder</option></select>
    <input class="r" value="${esc(m.role)}" placeholder="Role (founders only)" aria-label="Role">
    <input class="o" type="number" value="${m.order ?? 10}" aria-label="Order">
    <button class="b s" data-save>Save</button><button class="b s d" data-rm>Delete</button></div></div>`;
  async function loadMembers() {
    const s = await getDocs(collection(db, 'members'));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    $('seed').hidden = l.length > 0;
    $('mlist').innerHTML = l.length ? l.map(rowHtml).join('') : '<p class="mut">No members saved yet. The site is showing the default list.</p>';
  }
  $('seed').onclick = async () => {
    $('seed').disabled = true;
    for (const [name, type, role, order] of DEFAULTS) await addDoc(collection(db, 'members'), { name, type, role, order });
    $('seed').disabled = false; say('mmsg', 'Imported.'); loadMembers();
  };
  $('add').onclick = async () => {
    const name = $('nn').value.trim(); if (!name) return say('mmsg', 'Enter a name.', true);
    const type = $('nt').value;
    await addDoc(collection(db, 'members'), { name, type, role: type === 'founder' ? $('nr').value.trim() : '', order: +$('no').value || 10 });
    $('nn').value = ''; $('nr').value = ''; say('mmsg', 'Added.'); loadMembers();
  };
  $('mlist').onclick = async e => {
    const row = e.target.closest('.mrow'); if (!row) return; const id = row.dataset.id;
    if (e.target.hasAttribute('data-save')) {
      const type = row.querySelector('.t2').value;
      await updateDoc(doc(db, 'members', id), { name: row.querySelector('.n').value.trim(), type, role: type === 'founder' ? row.querySelector('.r').value.trim() : '', order: +row.querySelector('.o').value || 10 });
      say('mmsg', 'Saved.'); loadMembers();
    } else if (e.target.hasAttribute('data-rm') && confirm('Delete this person?')) {
      await deleteDoc(doc(db, 'members', id)); say('mmsg', 'Deleted.'); loadMembers();
    }
  };
}
