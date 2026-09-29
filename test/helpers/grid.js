// Fixture listing cards in the shapes content.js recognises (see CLAUDE.md,
// "DOM"). Each builder returns { el, box, link } where `el` is the outermost
// element to append, `box` the card and `link` its overlay link.

function card(doc, testid, id, { img = `https://images1.vinted.net/t/thumb/${id}/f310/x.webp` } = {}) {
  const box = doc.createElement("div");
  box.dataset.testid = testid;
  box.innerHTML = `
    <div class="new-item-box__image-container">
      <img src="${img}" alt="">
      <a data-testid="${testid}--overlay-link" href="https://www.vinted.ie/items/${id}-some-item"></a>
    </div>
    <p class="title">Item ${id}</p>`;
  return { box, link: box.querySelector("a") };
}

// Search and profile grids: product-item-id-N inside a grid-item cell.
export function searchCard(doc, id, opts) {
  const { box, link } = card(doc, `product-item-id-${id}`, id, opts);
  const el = doc.createElement("div");
  el.dataset.testid = "grid-item";
  el.append(box);
  return { el, box, link };
}

// Home feed: feed-item, here in a container with other children, so the cell
// is the card itself.
export function feedCard(doc, id, opts) {
  const { box, link } = card(doc, "feed-item", id, opts);
  const el = doc.createElement("div");
  const other = doc.createElement("span");
  other.textContent = "sponsored";
  el.append(box, other);
  return { el, box, link };
}

// Listing-page rails: similar_items-N / other_user_items-N, the only child of
// their wrapper, so the wrapper is the cell.
export function railCard(doc, kind, id, opts) {
  const { box, link } = card(doc, `${kind}-${id}`, id, opts);
  const el = doc.createElement("div");
  el.className = "rail-slot";
  el.append(box);
  return { el, box, link };
}

// A promoted closet: one seller's items, named by the box's testid.
export function closet(doc, sellerId, ids) {
  const el = doc.createElement("div");
  el.dataset.testid = `closet-promotion-${sellerId}`;
  const items = doc.createElement("div");
  const cards = ids.map((id) => card(doc, `item-${id}`, id));
  for (const c of cards) {
    const slot = doc.createElement("div");
    slot.append(c.box, doc.createElement("hr"));
    items.append(slot);
  }
  el.append(items);
  return { el, cards };
}

// jsdom has no layout: give an element a position for content.js's
// getBoundingClientRect() reads.
export function setRect(el, { top = 0, left = 0, width = 200, height = 300 } = {}) {
  el.getBoundingClientRect = () => ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top });
}

// A grid of search cards, `cols` per row, 300px tall rows starting at `top`.
// Item i (from 1) is listed by seller `seller(i)`. Returns the cards and the
// owner pairs to post.
export function grid(doc, n, { cols = 4, top = 0, seller = (i) => `u${i}`, first = 1, parent = doc.body } = {}) {
  const out = [];
  const pairs = [];
  for (let k = 0; k < n; k++) {
    const i = first + k;
    const c = searchCard(doc, String(i));
    setRect(c.el, { top: top + Math.floor(k / cols) * 300, left: (k % cols) * 200 });
    parent.append(c.el);
    out.push(c);
    pairs.push([String(i), seller(i), ""]);
  }
  return { cards: out, pairs };
}
