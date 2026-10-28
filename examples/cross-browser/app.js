import { captureException, init, setUser } from "@superlog/browser";

init({ endpoint: "https://intake.test", ingestKey: "test-key", release: "2026.10.28", service: "storefront" });
setUser({ id: "user-7" });

function renderTotal(cart) {
  return cart.total.toFixed(2);
}

function loadCart(id) {
  const carts = { a: { total: 10 } };
  return renderTotal(carts[id]);
}

document.getElementById("pay").addEventListener("click", () => {
  loadCart("missing");
});

window.reportHandled = () => {
  try {
    loadCart("missing");
  } catch (error) {
    captureException(error, { attributes: { "checkout.step": "pay" } });
  }
};
