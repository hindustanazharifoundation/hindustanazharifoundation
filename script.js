var mb=document.getElementById('mb'),ln=document.querySelector('.links');
mb.onclick=function(){var o=ln.classList.toggle('on');mb.setAttribute('aria-expanded',o)};
ln.onclick=function(e){if(e.target.tagName=='A')ln.classList.remove('on')};
var lb=document.getElementById('lb'),li=lb.querySelector('img');
document.querySelectorAll('.gal button').forEach(function(b){b.onclick=function(){var s=b.querySelector('img');li.src=s.src;li.alt=s.alt;lb.classList.add('on')}});
lb.onclick=function(){lb.classList.remove('on')};
document.addEventListener('keydown',function(e){if(e.key=='Escape')lb.classList.remove('on')});
