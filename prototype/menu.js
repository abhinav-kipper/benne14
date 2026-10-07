// Shared prototype data. Prices from the Benne 14 launch menu (14% off already applied).
// `hi` = Devanagari name, `desc` = short homely Hindi line shown under the dish.
window.MENU = {
  categories: [
    { id: "dosa", name: "Dosas", hi: "डोसा" },
    { id: "idli", name: "Idli & Vada", hi: "इडली · वड़ा" },
    { id: "drinks", name: "Coffee & Tea", hi: "कॉफ़ी · चाय" },
  ],
  items: [
    { id: "ghee-podi-benne-dosa", cat: "dosa", name: "Ghee Podi Benne Dosa", hi: "घी पोडी बेन्ने डोसा", mrp: 199, price: 171, special: true,
      desc: "घी में लिपटा, पोडी में लोटा, ऊपर से मक्खन का प्यारा सा टुकड़ा। माँ वाला प्यार, बेंगलुरु वाला स्वाद।" },
    { id: "masala-dosa", cat: "dosa", name: "Masala Dosa", hi: "मसाला डोसा", mrp: 209, price: 180,
      desc: "बाहर से कुरकुरा, अंदर आलू का गरमा-गरम मसाला। बिल्कुल घर जैसा।" },
    { id: "plain-benne-dosa", cat: "dosa", name: "Plain Benne Dosa", hi: "प्लेन बेन्ने डोसा", mrp: 159, price: 137,
      desc: "नरम बीच, कुरकुरे किनारे, और ढेर सारा मक्खन। बेंगलुरु की असली पहचान।" },
    { id: "plain-dosa", cat: "dosa", name: "Plain Dosa", hi: "प्लेन डोसा", mrp: 169, price: 145,
      desc: "सीधा-सादा, सुनहरा, हल्का। साथ में नारियल चटनी और सांभर।" },
    { id: "mallige-idli", cat: "idli", name: "Mallige Idli", hi: "मल्लिगे इडली", mrp: 89, price: 76,
      desc: "चमेली जैसी मुलायम, गरम सांभर के साथ। एक खाओगे, दो और मँगाओगे।" },
    { id: "thatte-idli", cat: "idli", name: "Thatte Idli", hi: "थट्टे इडली", mrp: 89, price: 76,
      desc: "थाली जितनी बड़ी, बादल जितनी नरम। दो चटनियों के साथ।" },
    { id: "ghee-podi-thatte-idli", cat: "idli", name: "Ghee Podi Thatte Idli", hi: "घी पोडी थट्टे इडली", mrp: 109, price: 94,
      desc: "घी में डूबी, पोडी में लिपटी। आपकी सुबह बना देगी।" },
    { id: "medu-vada", cat: "idli", name: "Udupi Medu Vada", hi: "उडुपी मेदु वड़ा", mrp: 89, price: 76,
      desc: "बाहर से कुरकुरा, अंदर से रुई जैसा नरम। उडुपी वाला असली स्वाद।" },
    { id: "filter-coffee", cat: "drinks", name: "Bengaluru Filter Coffee", hi: "फ़िल्टर कॉफ़ी", mrp: 69, price: 59, nophoto: true,
      desc: "स्टील के डबरा में झागदार गरम कॉफ़ी। बेंगलुरु की सुबह, आपके हाथ में।" },
    { id: "masala-tea", cat: "drinks", name: "Masala Tea", hi: "मसाला चाय", mrp: 49, price: 42,
      desc: "अदरक, इलायची, थोड़ी सी लौंग। दिल को सुकून देने वाली चाय।" },
  ],
};
// Demo cart for the screenshots (matches the order used across screens).
window.DEMO_CART = { "ghee-podi-benne-dosa": 1, "filter-coffee": 2 };
