// Trimmed samples of the data shapes Vinted serves (see CLAUDE.md, "Where
// seller IDs come from"). Only the fields the extension reads, plus a little
// noise around them.

const f800 = (n) => `https://images1.vinted.net/t/${n}/f800/photo.webp?s=sig${n}&v=1`;
export { f800 };

// Inline Next.js flight scripts hold a JS string of JSON. Next escapes "&" as
// & inside it, so HTML can't see an entity.
export const flightScript = (payload) =>
  `self.__next_f.push([1,${JSON.stringify(payload).replace(/&/g, "\\u0026")}])`;

// Server-rendered search page 1. 102 has its owner under user.id; 103 has no
// owner at all, so it mustn't take 104's.
export const searchFlight = flightScript(
  "5:[" + JSON.stringify([
    { productItem: { id: 101, title: "Coat", photos: [{ url: f800(101), dominant_color: "#fff" }], price: "10.00", ownerId: 201 } },
    { productItem: { id: 102, title: "Hat", photos: [{ url: f800(102) }], user: { id: 202 } } },
    { productItem: { id: 103, title: "Scarf", photos: [] } },
    { productItem: { id: 104, title: "Boots", ownerId: 204 } },
  ]) + "]",
);

// Home feed blocks. 302 uses string ids and user_id. 303 has no user, and
// the closet block after it names a seller that mustn't be taken as its owner.
export const homeFlight = flightScript(JSON.stringify({
  blocks: [
    { type: "item", entity: { id: 301, title: "Dress", user: { id: 401, login: "a" } } },
    { type: "item", entity: { id: "302", title: "Skirt", user_id: "402" } },
    { type: "item", entity: { id: 303, title: "Bag" } },
    { type: "closet", entity: { user: { id: 999 } } },
  ],
}));

// api.vinted.ie/svc-catalogue/items (pages 2+): item.user.id.
export const catalogue = {
  items: [
    {
      id: 501, title: "Jacket", user: { id: 601, login: "x" },
      photo: {
        thumbnails: [{ type: "thumb310", url: "https://images1.vinted.net/t/501/f310/a.webp" }, { type: "thumb800", url: f800(501) }],
        full_size_url: "https://images1.vinted.net/t/501/full/a.webp",
        url: "https://images1.vinted.net/t/501/plain/a.webp",
      },
    },
    { id: 502, user: { id: 602 }, photo: { full_size_url: "full-502", url: "url-502" } },
    { id: 503, user: { id: 603 }, photos: [{ url: "url-503" }, { url: "url-503b" }] },
    { id: 504, user: { id: 604 } },
  ],
  pagination: { current_page: 2 },
};

// homepage/homepage "load more": user_id as a string.
export const homepage = { blocks: [{ items: [{ id: "511", user_id: "611", photo: { url: "url-511" } }] }] };

// /api/v2/promoted_closets: items with user_id.
export const promotedClosets = {
  promoted_closets: [{ user: { login: "shop" }, items: [{ id: 521, user_id: 621, photos: [{ url: "url-521" }] }] }],
};

// item-details/more-items/<id>: items with user_id and an /items/ URL.
export const moreItems = { items: [{ id: 531, user_id: 631, url: "https://www.vinted.ie/items/531-thing" }] };

// /api/v2/wardrobe/<id>/items: item.user.id.
export const wardrobe = { items: [{ id: 541, user: { id: 641 } }] };

// Objects with a user_id that aren't listings.
export const feedback = { user_feedbacks: [{ id: 9001, user_id: 9002, feedback: "Great seller" }] };

// A listing nested deeper than collect() walks (depth > 8).
export const deep = (() => {
  let node = { id: 551, user: { id: 651 } };
  for (let i = 0; i < 10; i++) node = { wrap: node };
  return node;
})();

// A listing's own page: the photos array as escaped flight data, main photo
// first, plus the seller's profile picture as another f800 URL.
export function itemPage(id, n = 3, { extra = "" } = {}) {
  const photos = Array.from({ length: n }, (_, i) => ({
    id: i,
    thumbnails: [{ type: "thumb310", url: `https://images1.vinted.net/t/${id}-${i}/f310/p.webp` }, { type: "thumb800", url: f800(`${id}-${i}`) }],
    full_size_url: `https://images1.vinted.net/t/${id}-${i}/full/p.webp`,
  }));
  const data = { item: { id, title: 'A "quoted" [title] {x}', description: "back\\slash ] }", photos, extra } };
  return `<!doctype html><html><body>
    <img src="${f800("avatar")}">
    <script>${flightScript(JSON.stringify(data))}</script>
    <script>${flightScript(JSON.stringify({ user: { photo: { url: f800("avatar") } } }))}</script>
  </body></html>`;
}
