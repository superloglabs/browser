function renderTotal(cart) {
  return cart.total.toFixed(2);
}

function loadCart(id) {
  const carts = { a: { total: 10 } };
  const total = renderTotal(carts[id]);
  return total;
}

document.getElementById("pay").addEventListener("click", function onPay() {
  loadCart("missing");
});

window.reportHandled = function reportHandled() {
  try {
    loadCart("missing");
  } catch (error) {
    window.Superlog.captureException(error, { attributes: { "checkout.step": "pay" } });
  }
};
