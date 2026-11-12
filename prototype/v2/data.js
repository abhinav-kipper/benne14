window.MENU = {
  categories: [{ id: "dosa", name: "Dosas" }, { id: "idli", name: "Idli & Vada" }, { id: "drinks", name: "Coffee & Tea" }],
  items: [
    { id: "ghee-podi-benne-dosa", cat: "dosa", name: "Ghee Podi Benne Dosa", mrp: 199, price: 171, special: true, desc: "Crisp dosa, ghee and podi, finished with a pat of butter." },
    { id: "masala-dosa", cat: "dosa", name: "Masala Dosa", mrp: 209, price: 180, desc: "Crisp outside, warm potato masala inside." },
    { id: "plain-benne-dosa", cat: "dosa", name: "Plain Benne Dosa", mrp: 159, price: 137, desc: "Soft centre, crisp edges, plenty of butter." },
    { id: "plain-dosa", cat: "dosa", name: "Plain Dosa", mrp: 169, price: 145, desc: "Light and golden, with chutney and sambar." },
    { id: "mallige-idli", cat: "idli", name: "Mallige Idli", mrp: 89, price: 76, desc: "Jasmine-soft idlis with hot sambar." },
    { id: "thatte-idli", cat: "idli", name: "Thatte Idli", mrp: 89, price: 76, desc: "One big, cloud-soft idli with two chutneys." },
    { id: "ghee-podi-thatte-idli", cat: "idli", name: "Ghee Podi Thatte Idli", mrp: 109, price: 94, desc: "Thatte idli soaked in ghee and podi." },
    { id: "medu-vada", cat: "idli", name: "Udupi Medu Vada", mrp: 89, price: 76, desc: "Crisp outside, fluffy inside." },
    { id: "filter-coffee", cat: "drinks", name: "Filter Coffee", mrp: 69, price: 59, nophoto: true, desc: "Frothy, strong, in a steel dabara." },
    { id: "masala-tea", cat: "drinks", name: "Masala Tea", mrp: 49, price: 42, desc: "Ginger, cardamom and a little clove." }
  ]
};
window.CART = { "ghee-podi-benne-dosa": 1, "filter-coffee": 2 };
window.img = (it, cls='') => it.nophoto ? `<div class="nophoto ${cls}">Coffee</div>` : `<img class="${cls}" src="../assets/food/${it.id}.jpg" alt="">`;
window.ctl = (it) => window.CART[it.id] ? `<div class="qty"><button>−</button><span>${window.CART[it.id]}</span><button>+</button></div>` : `<button class="add" aria-label="Add">+</button>`;
