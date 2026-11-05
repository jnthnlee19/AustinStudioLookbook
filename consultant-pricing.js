let consultantExpires = 0;
let consultantTimer;
let customerPricing = { revision: 0, options: {} };
let priceSaveInFlight = false;
const pricingMoney = amount => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pricingTime = date => new Date(date).toLocaleString("en-US", { timeZoneName: "short" });

function pricingPrintHistory(card) {
  const update = customerPricing.options[card.dataset.option];
  if (!update) return "";
  return `<div style="font-size:11px;font-weight:400;white-space:normal;margin-top:6px">Original price: ${escapeHTML(update.originalPrice)}<br>New unit price: ${escapeHTML(update.priceText)}<br>Updated: ${escapeHTML(pricingTime(update.updatedAt))}</div>`;
}

function setConsultantUnlocked(expires = 0) {
  consultantExpires = expires;
  clearTimeout(consultantTimer);
  document.body.classList.toggle("consultant-unlocked", expires > Date.now());
  document.getElementById("pricing-unlock").textContent = expires > Date.now() ? "Lock pricing" : "Unlock";
  document.getElementById("pricing-status").textContent = expires > Date.now()
    ? "Consultant pricing unlocked. Choose Edit price on any option. Locks automatically after one hour."
    : "Consultant access";
  if (expires > Date.now()) consultantTimer = setTimeout(() => setConsultantUnlocked(), expires - Date.now());
}

async function pricingRequest(payload) {
  const response = await fetch("/.netlify/functions/consultant-pricing", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: activeCustomerLookbook?.id, ...payload })
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(response.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Unable to contact the pricing service."); }
  if (!response.ok) {
    if (response.status === 401) setConsultantUnlocked();
    if (result.pricing) applyCustomerPricing(result.pricing);
    else if (response.status === 409) await pollLiveUpdates();
    throw new Error(result.error || "Unable to save pricing.");
  }
  return result;
}

function setupCardPricing(card) {
  const price = card.querySelector(".price");
  card.dataset.originalDisplayPrice = price.textContent;
  card.dataset.originalNumericPrice = card.querySelector(".option-checkbox").dataset.price;
  card.dataset.originalSortPrice = card.dataset.sortPrice;
  card.dataset.originalPriceKnown = card.dataset.priceKnown;
  const history = document.createElement("div");
  history.className = "pricing-history";
  price.after(history);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-light pricing-edit";
  edit.textContent = "Edit price";
  edit.addEventListener("click", () => openPriceEditor(card));
  history.after(edit);
}

function applyCustomerPricing(pricing) {
  if (priceSaveInFlight || (pricing?.revision || 0) < customerPricing.revision) return;
  customerPricing = pricing || { revision: 0, options: {} };
  document.querySelectorAll(".option").forEach(card => {
    const update = customerPricing.options[card.dataset.option];
    const price = card.querySelector(".price");
    const checkbox = card.querySelector(".option-checkbox");
    const history = card.querySelector(".pricing-history");
    if (!price || !history) return;
    history.replaceChildren();
    if (!update) return;
    price.textContent = "New price: " + update.priceText;
    checkbox.dataset.price = String(update.amount);
    card.dataset.sortPrice = String(update.amount);
    card.dataset.priceKnown = "1";
    card.dataset.consultantPriced = "1";
    const original = document.createElement("div");
    original.textContent = "Original price: " + update.originalPrice;
    history.append(original);
    const time = document.createElement("div");
    time.textContent = "Updated: " + pricingTime(update.updatedAt);
    history.append(time);
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Price history";
    details.append(summary);
    (update.history || []).forEach(change => {
      const line = document.createElement("div");
      line.textContent = `${change.previousPrice} → ${change.priceText} · ${pricingTime(change.updatedAt)}`;
      details.append(line);
    });
    history.append(details);
  });
  updateTotal();
}

function openPriceEditor(card) {
  if (consultantExpires <= Date.now()) { setConsultantUnlocked(); return; }
  const dialog = document.getElementById("price-editor");
  const option = card.dataset.option;
  const update = customerPricing.options[option];
  dialog.dataset.option = option;
  dialog.dataset.revision = String(customerPricing.revision);
  document.getElementById("price-editor-title").textContent = "Update price · " + option;
  document.getElementById("price-editor-description").textContent = card.querySelector(".option-description").textContent;
  document.getElementById("price-editor-original").textContent = "Original price: " + (update?.originalPrice || card.dataset.originalDisplayPrice);
  document.getElementById("price-editor-current").textContent = "Current price: " + (update?.priceText || card.dataset.originalDisplayPrice);
  document.getElementById("consultant-price").value = update ? update.amount.toFixed(2) : card.dataset.originalPriceKnown === "1" ? Number(card.dataset.originalNumericPrice).toFixed(2) : "";
  document.getElementById("price-editor-error").textContent = "";
  dialog.showModal();
  document.getElementById("consultant-price").focus();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pricing-unlock").addEventListener("click", async () => {
    if (!activeCustomerLookbook?.id) { showToast("Open an active customer Lookbook first."); return; }
    if (consultantExpires > Date.now()) {
      setConsultantUnlocked();
      try { await pricingRequest({ action: "lock" }); } catch (error) { showToast(error.message); }
      return;
    }
    document.getElementById("pricing-password").value = "";
    document.getElementById("pricing-login-error").textContent = "";
    document.getElementById("pricing-login").showModal();
  });
  document.querySelectorAll(".pricing-cancel").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  document.getElementById("pricing-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const password = document.getElementById("pricing-password");
    try {
      const result = await pricingRequest({ action: "unlock", password: password.value });
      setConsultantUnlocked(result.expires);
      document.getElementById("pricing-login").close();
    } catch (error) { document.getElementById("pricing-login-error").textContent = error.message; }
    finally { password.value = ""; button.disabled = false; }
  });
  document.getElementById("price-editor-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (priceSaveInFlight) return;
    const dialog = document.getElementById("price-editor");
    const amount = Number(document.getElementById("consultant-price").value);
    const button = event.submitter;
    button.disabled = true;
    priceSaveInFlight = true;
    try {
      const result = await pricingRequest({ action: "save", option: dialog.dataset.option, amount, revision: Number(dialog.dataset.revision) });
      priceSaveInFlight = false;
      applyCustomerPricing(result.pricing);
      applyViewFilter();
      dialog.close();
      showToast("Price saved. Quote total updated.");
    } catch (error) {
      priceSaveInFlight = false;
      await pollLiveUpdates();
      dialog.dataset.revision = String(customerPricing.revision);
      const update = customerPricing.options[dialog.dataset.option];
      if (update) document.getElementById("price-editor-current").textContent = "Current price: " + update.priceText;
      document.getElementById("price-editor-error").textContent = error.message;
    } finally { priceSaveInFlight = false; button.disabled = false; }
  });
});
