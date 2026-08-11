/**
 * The designer panel.
 *
 * Built once, then updated in place. Rebuilding on every click is simpler to
 * write and also throws away keyboard focus every time you tab through the
 * swatches, which is the sort of thing that makes a demo feel like a demo.
 *
 * Every group reports which camera focus it wants when it becomes the active
 * group, and the panel tells main.js. Choosing an option and framing the thing
 * you just changed are one interaction, not two.
 */

import {
  GROUPS, PAYMENT_TABS, GAS_SAVINGS, priceConfig, money,
} from './catalog.js';
import { VEHICLES } from './vehicles.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function mountPanel(container, onChange, onFocus) {
  const panel = el('div', 'panel');

  /* ---------------- model switcher ---------------- */

  const switcher = el('div', 'models');
  const modelButtons = VEHICLES.map((v) => {
    const b = el('button', 'model');
    b.type = 'button';
    b.dataset.id = v.id;
    b.appendChild(el('span', 'model-name', v.name));
    b.appendChild(el('span', 'model-blurb', v.blurb));
    b.addEventListener('click', () => onChange({ vehicle: v.id }));
    switcher.appendChild(b);
    return b;
  });
  panel.appendChild(switcher);

  /* ---------------- headline ---------------- */

  const head = el('div', 'panel-head');
  const title = el('h1', 'model-title', '');
  head.appendChild(title);
  const specs = el('div', 'specs');
  const specNodes = {};
  for (const [key, unit, caption] of [
    ['range', 'mi', 'Range (est.)'],
    ['topSpeed', 'mph', 'Top Speed'],
    ['zeroToSixty', 's', '0-60 mph'],
  ]) {
    const cell = el('div', 'spec');
    const value = el('div', 'spec-value');
    const strong = el('span', 'spec-number', '—');
    value.appendChild(strong);
    value.appendChild(el('span', 'spec-unit', unit));
    cell.appendChild(value);
    cell.appendChild(el('div', 'spec-caption', caption));
    specs.appendChild(cell);
    specNodes[key] = strong;
  }
  head.appendChild(specs);
  panel.appendChild(head);

  const tabs = el('div', 'tabs');
  const tabButtons = PAYMENT_TABS.map((label) => {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.addEventListener('click', () => onChange({ payment: label }));
    tabs.appendChild(b);
    return b;
  });
  panel.appendChild(tabs);

  /* ---------------- trims (rebuilt per vehicle) ---------------- */

  const trimList = el('div', 'trim-list');
  panel.appendChild(trimList);
  let trimButtons = [];

  const buildTrims = (vehicle) => {
    trimList.replaceChildren();
    trimButtons = vehicle.trims.map((t) => {
      const b = el('button', 'trim');
      b.type = 'button';
      b.dataset.id = t.id;
      b.appendChild(el('span', 'trim-name', t.name));
      b.appendChild(el('span', 'trim-price', money(t.price)));
      b.addEventListener('click', () => onChange({ trim: t.id }));
      trimList.appendChild(b);
      return b;
    });
  };

  const savings = el('label', 'savings');
  const savingsBox = el('input');
  savingsBox.type = 'checkbox';
  savingsBox.addEventListener('change', () => onChange({ includeSavings: savingsBox.checked }));
  savings.appendChild(savingsBox);
  savings.appendChild(el('span', null, `Include est. 5-year gas savings of ${money(GAS_SAVINGS)}`));
  panel.appendChild(savings);

  /* ---------------- option groups ---------------- */

  const groupNodes = {};

  for (const group of GROUPS) {
    const wrap = el('section', 'option-group');
    wrap.dataset.title = group.title;

    const price = el('div', 'option-price', '');
    const name = el('div', 'option-name', '');
    wrap.appendChild(price);
    wrap.appendChild(name);

    // Opening a group frames what it changes.
    const focus = () => onFocus(group.focus, group.id);
    wrap.addEventListener('pointerenter', focus);
    wrap.addEventListener('focusin', focus);

    let buttons = [];
    if (group.kind === 'row') {
      const list = el('div', 'row-list');
      buttons = group.list.map((option) => {
        const b = el('button', 'row-option');
        b.type = 'button';
        b.dataset.id = option.id;
        b.appendChild(el('span', null, option.name));
        b.appendChild(el('span', 'row-price', option.price ? money(option.price) : 'Included'));
        b.addEventListener('click', () => {
          onChange({ [group.id]: option.id });
          focus();
        });
        list.appendChild(b);
        return b;
      });
      wrap.appendChild(list);
    } else if (group.kind === 'card') {
      // Wheels get cards, grouped under their brand, because a swatch cannot
      // tell you that something is a 22" deep dish from a different supplier.
      const brands = [...new Set(group.list.map((o) => o.brand))];
      buttons = [];
      for (const brand of brands) {
        wrap.appendChild(el('div', 'brand', brand));
        const grid = el('div', 'card-grid');
        for (const option of group.list.filter((o) => o.brand === brand)) {
          const b = el('button', 'card');
          b.type = 'button';
          b.dataset.id = option.id;
          b.appendChild(el('span', 'card-size', `${option.diameter}"`));
          b.appendChild(el('span', 'card-name', option.name.replace(/^\d+"\s*/, '')));
          b.appendChild(el('span', 'card-price', option.price ? money(option.price) : 'Included'));
          b.addEventListener('click', () => {
            onChange({ [group.id]: option.id });
            focus();
          });
          grid.appendChild(b);
          buttons.push(b);
        }
        wrap.appendChild(grid);
      }
    } else {
      const row = el('div', 'swatches');
      buttons = group.list.map((option) => {
        const b = el('button', 'swatch');
        b.type = 'button';
        b.dataset.id = option.id;
        b.style.setProperty('--swatch', option.swatch);
        b.title = option.name;
        b.setAttribute('aria-label', `${option.name}${option.price ? `, ${money(option.price)}` : ''}`);
        b.addEventListener('click', () => {
          onChange({ [group.id]: option.id });
          focus();
        });
        row.appendChild(b);
        return b;
      });
      wrap.appendChild(row);
    }

    panel.appendChild(wrap);
    groupNodes[group.id] = { wrap, price, name, buttons };
  }

  /* ---------------- footer ---------------- */

  const footer = el('div', 'panel-foot');
  const priceBlock = el('div', 'price-block');
  const priceValue = el('div', 'price-value', '—');
  priceBlock.appendChild(priceValue);
  priceBlock.appendChild(el('div', 'price-caption', 'Est. purchase price'));
  footer.appendChild(priceBlock);
  const order = el('button', 'order', 'Order Now');
  order.type = 'button';
  order.addEventListener('click', () => {
    order.textContent = 'Demo — nothing ordered';
    setTimeout(() => (order.textContent = 'Order Now'), 1800);
  });
  footer.appendChild(order);
  panel.appendChild(footer);

  panel.appendChild(
    el('p', 'disclaimer',
      'Unofficial technical demo. Not affiliated with, endorsed by, or sourced from Tesla. ' +
      'Aftermarket brand names are fictional; prices and figures are invented for illustration.')
  );

  container.appendChild(panel);

  const setActive = (buttons, id) => {
    for (const b of buttons) {
      const on = b.dataset.id === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  let currentVehicle = null;

  function update(state, vehicle) {
    if (vehicle !== currentVehicle) {
      currentVehicle = vehicle;
      buildTrims(vehicle);
      title.textContent = vehicle.name;
    }

    const p = priceConfig(state, vehicle);

    specNodes.range.textContent = String(p.specs.range);
    specNodes.topSpeed.textContent = String(p.specs.topSpeed);
    specNodes.zeroToSixty.textContent = p.specs.zeroToSixty.toFixed(1);

    modelButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.id === state.vehicle));
    tabButtons.forEach((b, i) => b.classList.toggle('is-active', PAYMENT_TABS[i] === state.payment));
    setActive(trimButtons, p.trim.id);
    savingsBox.checked = state.includeSavings;

    for (const group of GROUPS) {
      const node = groupNodes[group.id];
      const chosen = p.parts[group.id];
      node.price.textContent = chosen?.price ? money(chosen.price) : 'Included';
      node.name.textContent = chosen?.name ?? '';
      setActive(node.buttons, state[group.id]);
    }

    priceValue.textContent = money(p.total);
    return p;
  }

  return { update };
}

/** The dot strip under the render. */
export function mountViewDots(container, views, onPick) {
  const strip = el('div', 'view-dots');
  const prev = el('button', 'view-arrow', '‹');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous view');
  const next = el('button', 'view-arrow', '›');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next view');

  const dots = el('div', 'dots');
  const buttons = views.map((view, i) => {
    const b = el('button', 'dot');
    b.type = 'button';
    b.title = view.label;
    b.setAttribute('aria-label', view.label);
    b.addEventListener('click', () => onPick(i));
    dots.appendChild(b);
    return b;
  });

  prev.addEventListener('click', () => onPick(-1, true));
  next.addEventListener('click', () => onPick(1, true));

  strip.appendChild(prev);
  strip.appendChild(dots);
  strip.appendChild(next);
  container.appendChild(strip);

  return {
    update(index) {
      buttons.forEach((b, i) => b.classList.toggle('is-active', i === index));
    },
  };
}
