/* BowlBoard — adding a ball: choose the brand, then the ball (A–Z within the brand), then its weight. The same form is
 * on My arsenal and, in a sheet, behind "+ Add a ball…" when you start a game. A ball that isn't on the list can be
 * typed in. The list is the starter catalog plus, when it's loaded, the USBC Approved Ball List (see js/data.js). */
(function () {
'use strict';
const BB = window.BB;
const Store = window.BBStore, Data = window.BBData;
const { esc, toast, openSheet, closeSheet, ballIcon } = BB;

const WEIGHTS = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];
const listNote = () => {
  const i = Data.ballListInfo();
  return i ? 'Balls are from the ' + (i.source || 'USBC Approved Ball List') + (i.updated ? ', updated ' + i.updated : '') + '.' : 'A short list of popular balls. If yours isn’t here, choose “My ball isn’t listed”.';
};

function formHTML(p) {
  const brands = Data.ballBrands();
  const last = Store.state.balls[Store.state.balls.length - 1];
  const brand = last && brands.includes(last.brand) ? last.brand : brands[0];
  const weight = last && WEIGHTS.includes(+last.weight) ? +last.weight : 15;
  return '<div class="ball-form"><div class="ball-pick"><span id="' + p + 'Ico" class="ball-pick-ic">' + ballIcon(brand, 'lg') + '</span><div class="grow">' +
    '<label class="field">Brand<select id="' + p + 'Brand">' + brands.map(b => '<option value="' + esc(b) + '"' + (b === brand ? ' selected' : '') + '>' + esc(b) + '</option>').join('') +
    '<option value="__other">Other brand…</option></select></label>' +
    '<label class="field">Ball<select id="' + p + 'Ball"></select></label></div></div>' +
    '<div id="' + p + 'Custom" hidden>' +
    '<label class="field" id="' + p + 'BrandTextWrap" hidden>Brand name<input type="text" id="' + p + 'BrandText" placeholder="e.g. Storm"></label>' +
    '<label class="field">Ball name<input type="text" id="' + p + 'Name" placeholder="e.g. Hy-Road"></label>' +
    '<label class="field">Coverstock <span class="opt">(optional)</span><input type="text" id="' + p + 'Cover" placeholder="e.g. Hybrid Reactive"></label></div>' +
    '<label class="field">Weight (lb)<select id="' + p + 'Weight">' + WEIGHTS.map(w => '<option value="' + w + '"' + (w === weight ? ' selected' : '') + '>' + w + '</option>').join('') + '</select></label>' +
    '<div class="small muted">' + esc(listNote()) + '</div></div>';
}

// Wire a form made by formHTML inside `root`.
function bindForm(root, p) {
  const q = id => root.querySelector('#' + p + id);
  const tint = () => { q('Ico').innerHTML = ballIcon(q('Brand').value === '__other' ? q('BrandText').value : q('Brand').value, 'lg'); };
  const custom = () => { q('Custom').hidden = !(q('Brand').value === '__other' || q('Ball').value === '__custom'); };
  const fill = () => {
    const brand = q('Brand').value, other = brand === '__other', ball = q('Ball');
    q('BrandTextWrap').hidden = !other;
    ball.disabled = other;
    ball.innerHTML = other ? '<option value="__custom">Type it in below</option>'
      : Data.ballsOf(brand).map(b => '<option value="' + esc(b.name) + '">' + esc(b.name + (b.cover ? ' · ' + b.cover : '')) + '</option>').join('') + '<option value="__custom">My ball isn’t listed…</option>';
    custom(); tint();
  };
  q('Brand').addEventListener('change', fill);
  q('Ball').addEventListener('change', custom);
  q('BrandText').addEventListener('input', tint);
  fill();
}

// { ball } ready for Store.addBall, or { error } to show.
function readForm(root, p) {
  const q = id => root.querySelector('#' + p + id);
  const weight = +q('Weight').value, brandSel = q('Brand').value, ballSel = q('Ball').value;
  if (brandSel === '__other' || ballSel === '__custom') {
    const name = q('Name').value.trim();
    if (!name) return { error: 'Give the ball a name' };
    return { ball: { brand: (brandSel === '__other' ? q('BrandText').value.trim() : brandSel) || 'Custom', name, cover: q('Cover').value.trim(), weight, custom: true } };
  }
  const info = Data.ballsOf(brandSel).find(b => b.name === ballSel);
  return { ball: { brand: brandSel, name: ballSel, cover: info ? info.cover : '', weight, custom: false } };
}

// A sheet to add one ball; onAdded(ball) runs after it's saved, onCancel() if it's closed without adding.
function addBallSheet(onAdded, onCancel) {
  let added = false;
  openSheet('<h3>Add a ball</h3>' + formHTML('ab') + '<button class="btn mt8" id="abAdd">Add to my arsenal</button>', sh => {
    bindForm(sh, 'ab');
    sh.querySelector('#abAdd').addEventListener('click', () => {
      const r = readForm(sh, 'ab');
      if (r.error) { toast(r.error); return; }
      const b = Store.addBall(r.ball);
      added = true;
      closeSheet();
      toast('Added ' + b.brand + ' ' + b.name);
      if (onAdded) onAdded(b);
    });
  }, () => { if (!added && onCancel) onCancel(); });
}

Object.assign(BB, { ballFormHTML: formHTML, bindBallForm: bindForm, readBallForm: readForm, addBallSheet });
})();
