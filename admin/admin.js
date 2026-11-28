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
  const { getFirestore, collection, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, deleteField, doc, serverTimestamp } = fs;
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
    ['ph', 'mem', 'proj', 'sug', 'ev', 'vm', 'pt', 'fp', 'ar'].forEach(id => $(id).hidden = id !== b.dataset.t);
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

  // ---- upcoming events (poster is shrunk in the browser, like gallery photos)
  $('eup').onclick = async () => {
    const t = $('et').value.trim(), f = $('ep').files[0];
    if (!t) return say('emsg', 'Enter the title.', true);
    if (!f) return say('emsg', 'Choose a poster image.', true);
    let y = $('ey').value.trim(); if (y && !/^https?:\/\//i.test(y)) y = 'https://' + y;
    $('eup').disabled = true; say('emsg', 'Uploading…');
    try {
      const poster = await shrink(f);
      await addDoc(collection(db, 'events'), { poster, title: t, desc: $('ed').value.trim(), youtube: y, createdAt: serverTimestamp() });
      $('et').value = ''; $('ed').value = ''; $('ey').value = ''; $('ep').value = '';
      say('emsg', 'Done. Event added to the site.');
    } catch (e) { console.error(e); say('emsg', 'Upload failed. Check your internet and Firestore rules, then try again.', true); }
    $('eup').disabled = false; loadEvents();
  };
  async function loadEvents() {
    const s = await getDocs(collection(db, 'events'));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9));
    $('elist').innerHTML = l.length ? l.map(x => `<div class="evrow" data-id="${x.id}"><img src="${x.poster}" alt=""><div>
      <input class="et" value="${esc(x.title)}" aria-label="Title"><input class="ey" value="${esc(x.youtube)}" placeholder="YouTube link" aria-label="YouTube link"><input class="ed" value="${esc(x.desc)}" placeholder="Short description" aria-label="Description">
      <div class="btns"><button class="b s" data-esave>Save</button><button class="b s d" data-erm>Delete</button></div></div></div>`).join('') : '<p class="mut">No events yet.</p>';
  }
  $('elist').onclick = async e => {
    const row = e.target.closest('.evrow'); if (!row) return; const id = row.dataset.id;
    if (e.target.hasAttribute('data-esave')) {
      let y = row.querySelector('.ey').value.trim(); if (y && !/^https?:\/\//i.test(y)) y = 'https://' + y;
      const title = row.querySelector('.et').value.trim(); if (!title) return say('emsg', 'Title cannot be empty.', true);
      await updateDoc(doc(db, 'events', id), { title, youtube: y, desc: row.querySelector('.ed').value.trim() });
      say('emsg', 'Saved.'); loadEvents();
    } else if (e.target.hasAttribute('data-erm') && confirm('Delete this event?')) {
      await deleteDoc(doc(db, 'events', id)); say('emsg', 'Deleted.'); loadEvents();
    }
  };

  // ---- valuable members and supporters/partners (simple lists)
  function crud(col, listId, msgId, fields, need) {
    async function load() {
      const s = await getDocs(collection(db, col));
      const l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      $(listId).innerHTML = l.length ? l.map(x => `<div class="mrow" data-id="${x.id}"><div class="row cr">${fields.map(f => `<input data-k="${f.k}" type="${f.type || 'text'}" value="${esc(x[f.k] ?? '')}" placeholder="${f.ph}" aria-label="${f.ph}">`).join('')}<button class="b s" data-save>Save</button><button class="b s d" data-rm>Delete</button></div></div>`).join('') : '<p class="mut">Nothing added yet.</p>';
    }
    $(listId).onclick = async e => {
      const row = e.target.closest('.mrow'); if (!row) return; const id = row.dataset.id;
      if (e.target.hasAttribute('data-save')) {
        const data = {}; row.querySelectorAll('input').forEach(i => { data[i.dataset.k] = i.type === 'number' ? (+i.value || 10) : i.value.trim(); });
        if (!need.some(k => data[k])) return say(msgId, 'Fill at least: ' + need.join(' or ') + '.', true);
        await updateDoc(doc(db, col, id), data); say(msgId, 'Saved.'); load();
      } else if (e.target.hasAttribute('data-rm') && confirm('Delete this entry?')) {
        await deleteDoc(doc(db, col, id)); say(msgId, 'Deleted.'); load();
      }
    };
    return { load, async add(data) { await addDoc(collection(db, col), data); say(msgId, 'Added.'); load(); } };
  }
  const VM = crud('vmembers', 'vlist', 'vmsg', [{ k: 'name', ph: 'Name' }, { k: 'order', ph: 'Order', type: 'number' }], ['name']);
  const PT = crud('partners', 'ptlist', 'ptmsg', [{ k: 'name', ph: 'Name (optional)' }, { k: 'company', ph: 'Company name (optional)' }, { k: 'order', ph: 'Order', type: 'number' }], ['name', 'company']);
  $('vadd').onclick = async () => {
    const name = $('vn').value.trim(); if (!name) return say('vmsg', 'Enter a name.', true);
    await VM.add({ name, order: +$('vo').value || 10 }); $('vn').value = '';
  };
  $('ptadd').onclick = async () => {
    const name = $('ptn').value.trim(), company = $('ptc').value.trim();
    if (!name && !company) return say('ptmsg', 'Enter a name or a company name.', true);
    await PT.add({ name, company, order: +$('pto').value || 10 }); $('ptn').value = ''; $('ptc').value = '';
  };
  loadEvents(); VM.load(); PT.load();

  // ---- future plans: image + project PDF (one document: site/future, PDF pieces in site/future/chunks)
  const FP = doc(db, 'site', 'future'), FP_CAP = 'Concept design of our planned HAF Kidzee centre';
  const wipeFp = async () => { const s = await getDocs(collection(db, 'site', 'future', 'chunks')); for (const d of s.docs) await deleteDoc(d.ref); };
  async function loadFp() {
    let d = {};
    try { const s = await getDoc(FP); if (s.exists()) d = s.data(); } catch (e) { console.error(e); say('fpmsg', 'Could not load. Publish the latest firestore.rules and refresh.', true); }
    const shown = d.image || (d.hideImage ? '' : '../kidzee.jpg');
    $('fpprev').innerHTML = shown ? `<img src="${shown}" alt=""><p class="mut">${d.image ? 'Your uploaded image.' : 'Default Kidzee image (nothing uploaded yet).'}</p>` : '<p class="mut">No image is shown on the site right now.</p>';
    $('fpdel').hidden = !shown;
    $('fpc').value = typeof d.caption === 'string' ? d.caption : FP_CAP;
    $('fppinfo').textContent = d.pdfChunks ? `Current PDF: ${d.pdfName} · ${mb(d.pdfSize || 0)}` : 'No PDF added yet, so the button is hidden on the site.';
    $('fppdel').hidden = !d.pdfChunks;
  }
  $('fpup').onclick = async () => {
    const f = $('fpf').files[0]; if (!f) return say('fpmsg', 'Choose an image first.', true);
    $('fpup').disabled = true; say('fpmsg', 'Uploading…');
    try {
      const image = await shrink(f);
      await setDoc(FP, { image, hideImage: false, updatedAt: serverTimestamp() }, { merge: true });
      $('fpf').value = ''; say('fpmsg', 'Done. Image updated on the site.');
    } catch (e) { console.error(e); say('fpmsg', 'Upload failed. Check your internet and Firestore rules, then try again.', true); }
    $('fpup').disabled = false; loadFp();
  };
  $('fpdel').onclick = async () => {
    if (!confirm('Remove the image from the Future Plans section?')) return;
    try { await setDoc(FP, { image: deleteField(), hideImage: true, updatedAt: serverTimestamp() }, { merge: true }); say('fpmsg', 'Image removed.'); }
    catch (e) { console.error(e); say('fpmsg', 'Could not remove. Try again.', true); }
    loadFp();
  };
  $('fpcs').onclick = async () => {
    try { await setDoc(FP, { caption: $('fpc').value.trim(), updatedAt: serverTimestamp() }, { merge: true }); say('fpmsg', 'Caption saved.'); }
    catch (e) { console.error(e); say('fpmsg', 'Could not save the caption.', true); }
    loadFp();
  };
  $('fppup').onclick = async () => {
    const f = $('fppf').files[0];
    if (!f) return say('fppmsg', 'Choose a PDF file.', true);
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return say('fppmsg', 'Only PDF files are allowed.', true);
    if (f.size > MAXPDF) return say('fppmsg', `This PDF is ${mb(f.size)}. Please compress it below 10 MB (ilovepdf.com / smallpdf.com) and try again.`, true);
    $('fppup').disabled = true; const n = Math.ceil(f.size / CHUNK);
    try {
      await wipeFp();
      for (let i = 0; i < n; i++) {
        say('fppmsg', `Uploading part ${i + 1} of ${n}…`);
        const d = await readB64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        await setDoc(doc(db, 'site', 'future', 'chunks', String(i).padStart(3, '0')), { i, d });
      }
      await setDoc(FP, { pdfName: f.name, pdfSize: f.size, pdfChunks: n, updatedAt: serverTimestamp() }, { merge: true });
      $('fppf').value = ''; say('fppmsg', 'Done. PDF button is now live under the image.');
    } catch (e) {
      console.error(e);
      try { await wipeFp(); await setDoc(FP, { pdfName: deleteField(), pdfSize: deleteField(), pdfChunks: deleteField() }, { merge: true }); } catch (_) {}
      say('fppmsg', 'Upload failed. Check your internet and Firestore rules, then try again.', true);
    }
    $('fppup').disabled = false; loadFp();
  };
  $('fppdel').onclick = async () => {
    if (!confirm('Delete the PDF? The button will disappear from the site.')) return;
    say('fppmsg', 'Deleting…');
    try { await wipeFp(); await setDoc(FP, { pdfName: deleteField(), pdfSize: deleteField(), pdfChunks: deleteField(), updatedAt: serverTimestamp() }, { merge: true }); say('fppmsg', 'PDF deleted.'); }
    catch (e) { console.error(e); say('fppmsg', 'Could not delete. Try again.', true); }
    loadFp();
  };
  loadFp();

  // ---- annual financial reports (collection "reports", PDF pieces in reports/<id>/chunks)
  const wipeRep = async id => { const s = await getDocs(collection(db, 'reports', id, 'chunks')); for (const d of s.docs) await deleteDoc(d.ref); };
  $('arup').onclick = async () => {
    const title = $('arh').value.trim(), f = $('arf').files[0];
    if (!title) return say('armsg', 'Enter the heading (e.g. Financial Year 2025-26).', true);
    if (!f) return say('armsg', 'Choose a PDF file.', true);
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return say('armsg', 'Only PDF files are allowed.', true);
    if (f.size > MAXPDF) return say('armsg', `This PDF is ${mb(f.size)}. Please compress it below 10 MB (ilovepdf.com / smallpdf.com) and try again.`, true);
    $('arup').disabled = true;
    const ref = doc(collection(db, 'reports')), n = Math.ceil(f.size / CHUNK);
    try {
      for (let i = 0; i < n; i++) {
        say('armsg', `Uploading part ${i + 1} of ${n}…`);
        const d = await readB64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        await setDoc(doc(db, 'reports', ref.id, 'chunks', String(i).padStart(3, '0')), { i, d });
      }
      await setDoc(ref, { title, fileName: f.name, size: f.size, chunks: n, createdAt: serverTimestamp() });
      $('arh').value = ''; $('arf').value = ''; say('armsg', 'Done. Report added to the site.');
    } catch (e) {
      console.error(e); try { await wipeRep(ref.id); } catch (_) {}
      say('armsg', 'Upload failed. Check your internet and Firestore rules, then try again.', true);
    }
    $('arup').disabled = false; loadReports();
  };
  async function loadReports() {
    let l = [];
    try {
      const s = await getDocs(collection(db, 'reports'));
      l = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.title).localeCompare(String(a.title), undefined, { numeric: true }));
    } catch (e) { console.error(e); say('armsg', 'Could not load. Publish the latest firestore.rules and refresh.', true); }
    $('arlist').innerHTML = l.length ? l.map(p => `<div class="mrow" data-id="${p.id}"><div class="row cr"><input class="rt" value="${esc(p.title)}" aria-label="Heading"><button class="b s" data-rsave>Save</button><button class="b s d" data-rrm>Delete</button></div><small class="mut">${esc(p.fileName)} · ${mb(p.size || 0)}</small></div>`).join('') : '<p class="mut">No reports yet.</p>';
  }
  $('arlist').onclick = async e => {
    const row = e.target.closest('.mrow'); if (!row) return; const id = row.dataset.id;
    if (e.target.hasAttribute('data-rsave')) {
      const title = row.querySelector('.rt').value.trim(); if (!title) return say('armsg', 'Heading cannot be empty.', true);
      try { await updateDoc(doc(db, 'reports', id), { title }); say('armsg', 'Saved.'); } catch (err) { console.error(err); say('armsg', 'Could not save.', true); }
      loadReports();
    } else if (e.target.hasAttribute('data-rrm') && confirm('Delete this report and its PDF?')) {
      say('armsg', 'Deleting…');
      try { await wipeRep(id); await deleteDoc(doc(db, 'reports', id)); say('armsg', 'Deleted.'); } catch (err) { console.error(err); say('armsg', 'Could not delete.', true); }
      loadReports();
    }
  };
  loadReports();

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
