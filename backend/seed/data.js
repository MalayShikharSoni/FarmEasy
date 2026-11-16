// Demo data for FarmEasy. Every account uses the same password (DEMO_PASSWORD).
//
// Times are relative to the moment the seed runs, so the data always looks
// fresh: "ago" values are in the past, "in" values are in the future.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const DEMO_PASSWORD = "Demo@1234";

export const users = {
  admin: { name: "FarmEasy Admin", email: "admin@example.com", role: "admin" },

  ramesh: { name: "Ramesh Patel", email: "ramesh.farmer@example.com", role: "farmer", phone: "9876500001" },
  sunita: { name: "Sunita Pawar", email: "sunita.farmer@example.com", role: "farmer", phone: "9876500002" },
  harpreet: { name: "Harpreet Singh", email: "harpreet.farmer@example.com", role: "farmer", phone: "9876500003" },
  manjunath: { name: "Manjunath Gowda", email: "manjunath.farmer@example.com", role: "farmer", phone: "9876500004" },
  vikram: { name: "Vikram Chauhan", email: "vikram.farmer@example.com", role: "farmer", phone: "9876500005" },

  anita: { name: "Anita Traders", email: "anita.buyer@example.com", role: "buyer", phone: "9876500011" },
  kisan: { name: "Kisan Fresh Foods", email: "kisan.buyer@example.com", role: "buyer", phone: "9876500012" },
  mehta: { name: "Mehta Agro Exports", email: "mehta.buyer@example.com", role: "buyer", phone: "9876500013" },
  green: { name: "GreenBasket Retail", email: "greenbasket.buyer@example.com", role: "buyer", phone: "9876500014" }
};

// Product photos: free under the Unsplash License (https://unsplash.com/license).
// `unsplashId` is the image id on images.unsplash.com; `page` is the photo page.
export const images = {
  cotton: { unsplashId: "1616431101491-554c0932ea40", page: "https://unsplash.com/photos/cotton-stem-with-white-bolls-kSdi_gqbGGs" },
  onions: { unsplashId: "1782546079922-dc780b7e1efd", page: "https://unsplash.com/photos/a-large-pile-of-red-onions-with-roots-visible-Pwkda53CDpw" },
  apples: { unsplashId: "1655361076904-f529d9e864fe", page: "https://unsplash.com/photos/a-bunch-of-apples-okJO93DPpQg" },
  bananas: { unsplashId: "1757332050958-b797a022c910", page: "https://unsplash.com/photos/a-bunch-of-ripe-yellow-bananas-with-brown-spots-Wim9GsDlHEU" },
  potatoes: { unsplashId: "1784043437526-edf12bdf6c78", page: "https://unsplash.com/photos/fresh-healthy-potatoes-at-a-market-stall-TpH_tuO69cA" },
  cauliflower: { unsplashId: "1568584711075-3d021a7c3ca3", page: "https://unsplash.com/photos/cauliflower-vegetable-macro-photography-D8ZrftlvNDE" },
  chillies: { unsplashId: "1597115580039-b849ed2d6398", page: "https://unsplash.com/photos/green-chili-peppers-in-close-up-photography-S3qKDfaFe-4" },
  wheat: { unsplashId: "1721026093614-1566b053cc6b", page: "https://unsplash.com/photos/a-close-up-of-a-field-of-wheat-TVIeU0tS8uM" },
  turmeric: { unsplashId: "1741513599050-487ccfb86275", page: "https://unsplash.com/photos/dried-turmeric-root-is-shown-zALm5VkUBWw" },
  rice: { unsplashId: "1586201375761-83865001e31c", page: "https://unsplash.com/photos/raw-white-rice-grains-background--LdilhDx3sk" },
  mangoes: { unsplashId: "1757281096712-d0c9fb17d608", page: "https://unsplash.com/photos/a-pile-of-ripe-mangoes-with-red-and-green-colors-7DrqdqKTroY" },
  tomatoes: { unsplashId: "1582284540020-8acbe03f4924", page: "https://unsplash.com/photos/red-tomatoes-on-brown-wooden-table-eb26eV-ys_k" }
};

/**
 * Listings, grouped by what they are for in a demo:
 *
 *  live        open for bidding (one with no bids yet, one ending soon)
 *  justEnded   ended a moment before seeding; the server's settlement job
 *              closes it on startup, so its timeline shows "AUTO_SETTLED"
 *  pending     waiting for the admin to approve or reject
 *  awaitingPay deal locked, buyer still has to pay (Razorpay test checkout)
 *  completed   locked, paid and reviewed
 *
 * Bids must follow the auction rules: the first bid >= minPrice, then each
 * bid >= previous + minBidHop. The seed checks this and refuses bad data.
 */
export const buildListings = ({ endingSoonMinutes }) => [
  // ----- live -----
  {
    key: "cotton",
    farmer: "ramesh",
    title: "Organic Shankar-6 cotton (kapas)",
    description:
      "Hand-picked, rain-fed Shankar-6 cotton from our 12-acre farm near Rajkot. Long staple, low trash content, sun-dried and stored in a covered godown. Organic certification documents available on request.",
    category: "other",
    quantity: 25,
    unit: "quintal",
    location: { state: "Gujarat", district: "Rajkot", village: "Jasdan" },
    minPrice: 175000,
    minBidHop: 1000,
    createdAgo: 2 * DAY + 3 * HOUR,
    approvedAgo: 2 * DAY,
    endsIn: 2 * DAY + 4 * HOUR,
    expiresIn: 20 * DAY,
    bids: [
      { buyer: "mehta", amount: 175000, ago: 40 * HOUR },
      { buyer: "anita", amount: 178000, ago: 30 * HOUR },
      { buyer: "mehta", amount: 181000, ago: 9 * HOUR },
      { buyer: "kisan", amount: 184000, ago: 2 * HOUR }
    ]
  },
  {
    key: "onions",
    farmer: "sunita",
    title: "Nashik red onions – Grade A",
    description:
      "Fresh rabi-season red onions from Lasalgaon, sorted and graded (55 mm+). Packed in 50 kg mesh bags, ready for pickup.",
    category: "vegetables",
    quantity: 40,
    unit: "quintal",
    location: { state: "Maharashtra", district: "Nashik", village: "Lasalgaon" },
    minPrice: 80000,
    minBidHop: 500,
    createdAgo: 26 * HOUR,
    approvedAgo: 24 * HOUR,
    endsIn: 6 * HOUR,
    expiresIn: 10 * DAY,
    bids: [
      { buyer: "green", amount: 80000, ago: 20 * HOUR },
      { buyer: "anita", amount: 82500, ago: 11 * HOUR },
      { buyer: "green", amount: 85000, ago: 3 * HOUR }
    ]
  },
  {
    key: "apples",
    farmer: "vikram",
    title: "Shimla Royal Delicious apples",
    description:
      "Crisp Royal Delicious apples from our orchard in Kotkhai, harvested this month. Hand-sorted, packed in 20 kg cartons.",
    category: "fruits",
    quantity: 800,
    unit: "kg",
    location: { state: "Himachal Pradesh", district: "Shimla", village: "Kotkhai" },
    minPrice: 64000,
    minBidHop: 500,
    createdAgo: 30 * HOUR,
    approvedAgo: 28 * HOUR,
    endsIn: 22 * HOUR,
    expiresIn: 25 * DAY,
    bids: [
      { buyer: "kisan", amount: 64000, ago: 26 * HOUR },
      { buyer: "green", amount: 66000, ago: 5 * HOUR }
    ]
  },
  {
    key: "bananas",
    farmer: "sunita",
    title: "Jalgaon Grand Naine bananas",
    description: "Export-quality Grand Naine bananas from Jalgaon, harvested at 75% maturity for transport.",
    category: "fruits",
    quantity: 2,
    unit: "ton",
    location: { state: "Maharashtra", district: "Jalgaon", village: "Raver" },
    minPrice: 50000,
    minBidHop: 500,
    createdAgo: 14 * HOUR,
    approvedAgo: 12 * HOUR,
    endsIn: 3 * DAY,
    expiresIn: 6 * DAY,
    bids: [{ buyer: "anita", amount: 50000, ago: 7 * HOUR }]
  },
  {
    key: "potatoes",
    farmer: "harpreet",
    title: "Jalandhar Kufri Jyoti potatoes",
    description: "Freshly harvested Kufri Jyoti potatoes from Jalandhar, washed and sized. No bids yet, be the first!",
    category: "vegetables",
    quantity: 50,
    unit: "quintal",
    location: { state: "Punjab", district: "Jalandhar", village: "Kartarpur" },
    minPrice: 60000,
    minBidHop: 500,
    createdAgo: 5 * HOUR,
    approvedAgo: 4 * HOUR,
    endsIn: 2 * DAY,
    expiresIn: 30 * DAY,
    bids: []
  },
  {
    key: "cauliflower",
    farmer: "harpreet",
    title: "Fresh winter cauliflower – ending soon",
    description:
      "Snow-white winter cauliflower from Punjab, cut this morning. This auction ends soon: when the timer runs out, FarmEasy locks the deal to the highest bidder automatically.",
    category: "vegetables",
    quantity: 1200,
    unit: "kg",
    location: { state: "Punjab", district: "Ludhiana", village: "Samrala" },
    minPrice: 24000,
    minBidHop: 200,
    createdAgo: 6 * HOUR,
    approvedAgo: 5 * HOUR,
    endsIn: endingSoonMinutes * MIN,
    expiresIn: 3 * DAY,
    bids: [
      { buyer: "green", amount: 24000, ago: 4 * HOUR },
      { buyer: "kisan", amount: 25000, ago: 90 * MIN }
    ]
  },

  // ----- just ended: the settlement job closes it when the API starts -----
  {
    key: "chillies",
    farmer: "manjunath",
    title: "Byadgi green chillies",
    description: "Fresh green Byadgi chillies, medium heat, picked two days ago. Packed in 25 kg crates.",
    category: "vegetables",
    quantity: 500,
    unit: "kg",
    location: { state: "Karnataka", district: "Haveri", village: "Byadgi" },
    minPrice: 30000,
    minBidHop: 250,
    createdAgo: 3 * DAY,
    approvedAgo: 3 * DAY - 2 * HOUR,
    endsIn: -2 * MIN,
    expiresIn: 4 * DAY,
    bids: [
      { buyer: "anita", amount: 30000, ago: 2 * DAY },
      { buyer: "mehta", amount: 31000, ago: 30 * HOUR },
      { buyer: "anita", amount: 32500, ago: 6 * HOUR }
    ]
  },

  // ----- pending admin approval -----
  {
    key: "wheat",
    farmer: "harpreet",
    title: "Sharbati wheat – 2026 harvest",
    description: "Clean, machine-graded Sharbati wheat, moisture below 12%. Stored in a warehouse in Moga.",
    category: "grains",
    quantity: 100,
    unit: "quintal",
    location: { state: "Punjab", district: "Moga", village: "Dharamkot" },
    minPrice: 245000,
    minBidHop: 1000,
    createdAgo: 2 * HOUR,
    expiresIn: 60 * DAY,
    pending: true
  },
  {
    key: "turmeric",
    farmer: "sunita",
    title: "Sangli turmeric fingers (dried)",
    description: "Polished, sun-dried Rajapuri turmeric fingers from Sangli, high curcumin content.",
    category: "spices",
    quantity: 10,
    unit: "quintal",
    location: { state: "Maharashtra", district: "Sangli", village: "Islampur" },
    minPrice: 140000,
    minBidHop: 1000,
    createdAgo: 40 * MIN,
    expiresIn: 90 * DAY,
    pending: true
  },

  // ----- deal locked, waiting for the buyer to pay -----
  {
    key: "rice",
    farmer: "harpreet",
    title: "Karnal 1121 basmati rice (paddy)",
    description: "Pusa 1121 basmati paddy from Karnal, long grain, aged six months.",
    category: "grains",
    quantity: 30,
    unit: "quintal",
    location: { state: "Haryana", district: "Karnal", village: "Taraori" },
    minPrice: 210000,
    minBidHop: 1000,
    createdAgo: 6 * DAY,
    approvedAgo: 6 * DAY - 3 * HOUR,
    endsIn: 2 * DAY,
    expiresIn: 45 * DAY,
    bids: [
      { buyer: "mehta", amount: 210000, ago: 5 * DAY },
      { buyer: "kisan", amount: 215000, ago: 4 * DAY },
      { buyer: "mehta", amount: 218000, ago: 2 * DAY },
      { buyer: "kisan", amount: 222000, ago: 30 * HOUR }
    ],
    lock: { by: "farmer", ago: 20 * HOUR }
  },

  // ----- completed: locked, paid and reviewed -----
  {
    key: "mangoes",
    farmer: "manjunath",
    title: "Kolar Totapuri mangoes",
    description: "Totapuri mangoes from Srinivaspur, ideal for pulp processing.",
    category: "fruits",
    quantity: 1000,
    unit: "kg",
    location: { state: "Karnataka", district: "Kolar", village: "Srinivaspur" },
    minPrice: 90000,
    minBidHop: 500,
    createdAgo: 30 * DAY,
    approvedAgo: 30 * DAY - 4 * HOUR,
    endsIn: -26 * DAY,
    expiresIn: -20 * DAY,
    bids: [
      { buyer: "green", amount: 90000, ago: 29 * DAY },
      { buyer: "kisan", amount: 94000, ago: 28 * DAY },
      { buyer: "green", amount: 98000, ago: 27 * DAY }
    ],
    lock: { by: "farmer", ago: 27 * DAY - 6 * HOUR },
    payment: { ago: 27 * DAY - 8 * HOUR, via: "webhook" },
    review: { rating: 5, comment: "Excellent quality, exactly as described. Smooth pickup.", ago: 24 * DAY }
  },
  {
    key: "tomatoes",
    farmer: "manjunath",
    title: "Kolar hybrid tomatoes",
    description: "Firm hybrid tomatoes from Kolar, graded and crated for long-distance transport.",
    category: "vegetables",
    quantity: 2,
    unit: "ton",
    location: { state: "Karnataka", district: "Kolar", village: "Mulbagal" },
    minPrice: 36000,
    minBidHop: 250,
    createdAgo: 12 * DAY,
    approvedAgo: 12 * DAY - 2 * HOUR,
    endsIn: -9 * DAY,
    expiresIn: -5 * DAY,
    bids: [
      { buyer: "anita", amount: 36000, ago: 11 * DAY },
      { buyer: "green", amount: 38000, ago: 10 * DAY },
      { buyer: "anita", amount: 39500, ago: 10 * DAY - 5 * HOUR }
    ],
    lock: { by: "system", ago: 9 * DAY },
    payment: { ago: 9 * DAY - 3 * HOUR, via: "checkout" },
    review: { rating: 4, comment: "Good tomatoes, a few crates were softer than expected.", ago: 8 * DAY }
  }
];
