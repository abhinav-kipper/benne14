// The menu lives in code for v1 (prices from the Benne 14 launch menu, 14% off applied).
// A price change is a one-line edit + deploy until the owner admin (M4) moves this into the DB.

export type CategoryId = 'dosa' | 'idli' | 'drinks';

export interface Category {
  id: CategoryId;
  name: string;
  hi: string;
}

export interface ModOption {
  id: string;
  name: string;
  hi?: string;
  price: number; // rupees added per unit
}

export interface ModGroup {
  id: string;
  name: string;
  kind: 'one' | 'many'; // 'one' = pick exactly one (has a default), 'many' = optional extras
  defaultId?: string;
  options: ModOption[];
}

export interface MenuItem {
  id: string;
  cat: CategoryId;
  name: string;
  hi: string;
  desc: string; // homely Hindi line
  price: number;
  mrp: number;
  photo?: string; // /food/<id>.jpg
  special?: boolean;
  groups: string[]; // ModGroup ids
  notes: boolean; // kitchen notes allowed
}

export interface KitchenNote {
  id: string;
  label: string;
  hi: string; // what the cook reads
}

export const CATEGORIES: Category[] = [
  { id: 'dosa', name: 'Dosas', hi: 'डोसा' },
  { id: 'idli', name: 'Idli & Vada', hi: 'इडली · वड़ा' },
  { id: 'drinks', name: 'Coffee & Tea', hi: 'कॉफ़ी · चाय' },
];

export const GROUPS: Record<string, ModGroup> = {
  spice: {
    id: 'spice', name: 'Podi spice', kind: 'one', defaultId: 'regular',
    options: [
      { id: 'mild', name: 'Mild', hi: 'कम तीखा', price: 0 },
      { id: 'regular', name: 'Regular', hi: 'नॉर्मल', price: 0 },
      { id: 'fiery', name: 'Fiery', hi: 'तीखा', price: 0 },
    ],
  },
  dosaExtras: {
    id: 'dosaExtras', name: 'Make it extra', kind: 'many',
    options: [
      { id: 'benne', name: 'Extra benne', hi: '+ बेन्ने', price: 25 },
      { id: 'podi', name: 'Extra podi', hi: '+ पोडी', price: 15 },
      { id: 'palya', name: 'Extra palya', hi: '+ पल्या', price: 30 },
      { id: 'sambar', name: 'Sambar bowl', hi: '+ सांभर कटोरी', price: 20 },
    ],
  },
  idliExtras: {
    id: 'idliExtras', name: 'Make it extra', kind: 'many',
    options: [
      { id: 'sambar', name: 'Sambar bowl', hi: '+ सांभर कटोरी', price: 20 },
      { id: 'ghee', name: 'Extra ghee', hi: '+ घी', price: 15 },
    ],
  },
  sugar: {
    id: 'sugar', name: 'Sugar', kind: 'one', defaultId: 'regular',
    options: [
      { id: 'regular', name: 'Regular sugar', hi: 'नॉर्मल चीनी', price: 0 },
      { id: 'less', name: 'Less sugar', hi: 'कम चीनी', price: 0 },
      { id: 'none', name: 'No sugar', hi: 'बिना चीनी', price: 0 },
    ],
  },
};

export const NOTES: KitchenNote[] = [
  { id: 'no-onion', label: 'No onion', hi: 'प्याज़ नहीं' },
  { id: 'less-oil', label: 'Less oil', hi: 'कम तेल' },
  { id: 'extra-crisp', label: 'Extra crisp', hi: 'ज़्यादा कुरकुरा' },
  { id: 'chutney-separate', label: 'Chutney separate', hi: 'चटनी अलग' },
  { id: 'cut-half', label: 'Cut in half', hi: 'आधा काटना' },
  { id: 'extra-sambar', label: 'Extra sambar', hi: 'सांभर ज़्यादा' },
];

const dosa = ['spice', 'dosaExtras'];
const idli = ['idliExtras'];

export const ITEMS: MenuItem[] = [
  { id: 'ghee-podi-benne-dosa', cat: 'dosa', name: 'Ghee Podi Benne Dosa', hi: 'घी पोडी बेन्ने डोसा', price: 171, mrp: 199, special: true, groups: dosa, notes: true,
    desc: 'घी में लिपटा, पोडी में लोटा, ऊपर से मक्खन का प्यारा सा टुकड़ा। माँ वाला प्यार, बेंगलुरु वाला स्वाद।' },
  { id: 'masala-dosa', cat: 'dosa', name: 'Masala Dosa', hi: 'मसाला डोसा', price: 180, mrp: 209, groups: dosa, notes: true,
    desc: 'बाहर से कुरकुरा, अंदर आलू का गरमा-गरम मसाला। बिल्कुल घर जैसा।' },
  { id: 'plain-benne-dosa', cat: 'dosa', name: 'Plain Benne Dosa', hi: 'प्लेन बेन्ने डोसा', price: 137, mrp: 159, groups: dosa, notes: true,
    desc: 'नरम बीच, कुरकुरे किनारे, और ढेर सारा मक्खन। बेंगलुरु की असली पहचान।' },
  { id: 'plain-dosa', cat: 'dosa', name: 'Plain Dosa', hi: 'प्लेन डोसा', price: 145, mrp: 169, groups: dosa, notes: true,
    desc: 'सीधा-सादा, सुनहरा, हल्का। साथ में नारियल चटनी और सांभर।' },
  { id: 'mallige-idli', cat: 'idli', name: 'Mallige Idli', hi: 'मल्लिगे इडली', price: 76, mrp: 89, groups: idli, notes: true,
    desc: 'चमेली जैसी मुलायम, गरम सांभर के साथ। एक खाओगे, दो और मँगाओगे।' },
  { id: 'thatte-idli', cat: 'idli', name: 'Thatte Idli', hi: 'थट्टे इडली', price: 76, mrp: 89, groups: idli, notes: true,
    desc: 'थाली जितनी बड़ी, बादल जितनी नरम। दो चटनियों के साथ।' },
  { id: 'ghee-podi-thatte-idli', cat: 'idli', name: 'Ghee Podi Thatte Idli', hi: 'घी पोडी थट्टे इडली', price: 94, mrp: 109, groups: idli, notes: true,
    desc: 'घी में डूबी, पोडी में लिपटी। आपकी सुबह बना देगी।' },
  { id: 'medu-vada', cat: 'idli', name: 'Udupi Medu Vada', hi: 'उडुपी मेदु वड़ा', price: 76, mrp: 89, groups: idli, notes: true,
    desc: 'बाहर से कुरकुरा, अंदर से रुई जैसा नरम। उडुपी वाला असली स्वाद।' },
  { id: 'filter-coffee', cat: 'drinks', name: 'Bengaluru Filter Coffee', hi: 'फ़िल्टर कॉफ़ी', price: 59, mrp: 69, groups: ['sugar'], notes: false,
    desc: 'स्टील के डबरा में झागदार गरम कॉफ़ी। बेंगलुरु की सुबह, आपके हाथ में।' },
  { id: 'masala-tea', cat: 'drinks', name: 'Masala Tea', hi: 'मसाला चाय', price: 42, mrp: 49, groups: ['sugar'], notes: false,
    desc: 'अदरक, इलायची, थोड़ी सी लौंग। दिल को सुकून देने वाली चाय।' },
];

// Items with a real photo in /public/food. Filter coffee is waiting for the restaurant's own photo.
const PHOTOS = new Set(ITEMS.map((i) => i.id).filter((id) => id !== 'filter-coffee'));
export const photoOf = (id: string) => (PHOTOS.has(id) ? `/food/${id}.jpg` : undefined);

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);

// Shown as "Goes well with" in the item sheet and "Kuch aur?" in the cart.
export const PAIRING = 'filter-coffee';
export const CART_UPSELL = ['medu-vada', 'mallige-idli', 'masala-tea'];
