'use strict';

// --- State Management ---
let pricingDatabase = JSON.parse(localStorage.getItem('pricingDB')) || [];
let currentQuote = JSON.parse(localStorage.getItem('quoteCart')) || [];
let currentSearchResults = [];
// Add this timer variable to the top of your app.js state management
let searchTimeout = null;
let savedBaskets = JSON.parse(localStorage.getItem('savedQuotesDatabase')) || [];
let selectedBasketIds = new Set(); // Tracks checkbox selection for bulk export/delete (session-only, not persisted)
// Unsaved drafts do not consume a number; only saved "Quote N" names count.
function getNextQuoteName() {
    const highestNumber = savedBaskets.reduce((highest, basket) => {
        const match = /^Quote (\d+)$/i.exec(basket.name.trim());
        return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `Quote ${highestNumber + 1}`;
}

// Persisted so an in-progress quote keeps its id/name (and doesn't fork into a new entry) across reloads.
let currentBasketId = localStorage.getItem('currentBasketId') || Date.now().toString();
let currentBasketName = localStorage.getItem('currentBasketName') || getNextQuoteName();
localStorage.setItem('currentBasketId', currentBasketId);
localStorage.setItem('currentBasketName', currentBasketName);

let taxRate = parseFloat(localStorage.getItem('taxRate'));
if (isNaN(taxRate)) taxRate = 18;
let includeTax = localStorage.getItem('includeTax') !== 'false';
let priceValidityDate = localStorage.getItem('priceValidityDate') || getDefaultMonthEndDate();
let additionalConditions = localStorage.getItem('additionalConditions') || '';
let multiYearSplitEnabled = localStorage.getItem('multiYearSplitEnabled') !== 'false';

// --- Initialization (Fixed: Runs immediately instead of waiting for delayed DOM signal) ---
function initApp() {
    updateMemoryDisplay();
    updateFileDropdown();
    renderDbPreview();
    // toggleControlSidebar(); // Start with sidebar collapsed
    renderUI(); // Forces cart to load from localStorage immediately

    renderSavedBaskets();

    const basketNameInput = document.getElementById('basketNameInput');
    if (basketNameInput) basketNameInput.value = currentBasketName;

    const taxInput = document.getElementById('taxRate');
    if (taxInput) taxInput.value = taxRate;

    const taxCheck = document.getElementById('includeTax');
    if (taxCheck) taxCheck.checked = includeTax;

    const validityInput = document.getElementById('priceValidity');
    if (validityInput) validityInput.value = priceValidityDate;

    const conditionsInput = document.getElementById('additionalConditions');
    if (conditionsInput) conditionsInput.value = additionalConditions;

    const multiYearCheck = document.getElementById('multiYearSplitToggle');
    if (multiYearCheck) multiYearCheck.checked = multiYearSplitEnabled;

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        const autocompleteList = document.getElementById('autocompleteResults');
        const searchInput = document.getElementById('searchName');
        if (autocompleteList && e.target !== searchInput && !autocompleteList.contains(e.target)) {
            autocompleteList.classList.remove('active');
        }
    });
}
initApp();

// --- UI Toggles & Toasts ---
function toggleControlSidebar() {
    document.getElementById('controlSidebar').classList.toggle('collapsed');
}

function switchSidebarTab(tabName) {
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    document.querySelectorAll('.sidebar-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.tabPanel === tabName));
}

function openDatabaseModal() {
    document.getElementById('databaseModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function showToast(message, type = 'default', timeout = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    if (type === 'error') toast.style.background = '#dc2626';
    else if (type === 'success') toast.style.background = '#10b981';
    else toast.style.background = 'var(--brand-dark)';

    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), timeout);
}

// --- Formatters ---
function formatINR(number) {
    return "₹ " + number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDefaultMonthEndDate() {
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return monthEnd.toISOString().split('T')[0];
}

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function parseMoneyString(str) {
    if (!str) return 0;
    const cleaned = parseFloat(str.toString().replace(/[^0-9.-]+/g, ""));
    return isNaN(cleaned) ? 0 : cleaned;
}

function cleanStringForMatch(str) {
    if (!str) return "";
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// CSP-style catalogs (e.g. Microsoft NCE) reuse the same short SkuId (1, 2, 3...) across
// hundreds of unrelated ProductIds, so SkuId only identifies a SKU when paired with its
// ProductId. Matching on SkuId alone causes unrelated products to collide (e.g. everything
// with "variant #1" gets treated as the same SKU). When both are present we combine them
// into one composite key; otherwise we fall back to whichever identifier is available.
function buildSkuMatchKeys(row, skuIdKey, productIdKey, partNumberKey) {
    const cleanSku = (skuIdKey && row[skuIdKey]) ? cleanStringForMatch(row[skuIdKey]) : "";
    const cleanProduct = (productIdKey && row[productIdKey]) ? cleanStringForMatch(row[productIdKey]) : "";
    const cleanPart = (partNumberKey && row[partNumberKey]) ? cleanStringForMatch(row[partNumberKey]) : "";

    const keys = [];
    if (cleanProduct && cleanSku) keys.push(cleanProduct + '::' + cleanSku);
    else if (cleanSku) keys.push(cleanSku);
    else if (cleanProduct) keys.push(cleanProduct);
    if (cleanPart) keys.push(cleanPart);
    return keys;
}

// Different source files label the same identifier column differently (e.g. "Part No",
// "MPN", "SKU Code"), so we match on a broad alias list instead of one exact header name.
function findIdColumnKey(keyMap, aliases) {
    for (const alias of aliases) {
        if (keyMap[alias]) return keyMap[alias];
    }
    const cleanKeys = Object.keys(keyMap);
    for (const alias of aliases) {
        const hit = cleanKeys.find(k => k.includes(alias));
        if (hit) return keyMap[hit];
    }
    return null;
}

const SKU_ID_ALIASES = ['skuid', 'sku', 'skucode', 'skunumber'];
const PRODUCT_ID_ALIASES = ['productid', 'itemnumber', 'itemcode', 'itemid', 'productcode'];
const PART_NUMBER_ALIASES = ['partnumber', 'partno', 'mpn', 'manufacturerpartnumber', 'vendorpartnumber', 'oempartnumber', 'materialnumber', 'materialno', 'modelnumber', 'catalognumber', 'catalogno'];

function saveCart() {
    localStorage.setItem('quoteCart', JSON.stringify(currentQuote));
}

// --- Dynamic Search (Fixed Catalog Selection) ---
function executeSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const rawInput = document.getElementById('searchName').value.toLowerCase().trim();
        const listEl = document.getElementById('autocompleteResults');
        const activeCatalog = document.getElementById('fileFilter').value;

        listEl.innerHTML = '';

        if (pricingDatabase.length === 0) {
            listEl.classList.remove('active');
            return;
        }

        // Fix: If no text is typed AND we are on 'All Catalogs', hide the dropdown.
        // But if a specific catalog is selected, we want to show the first 50 items inside it.
        if (!rawInput && activeCatalog === 'all') {
            listEl.classList.remove('active');
            return;
        }

        let targetDB = activeCatalog !== 'all' ? pricingDatabase.filter(i => getCatalogId(i) === activeCatalog) : pricingDatabase;

        if (rawInput) {
            const searchTokens = rawInput.split(/\s+/);
            currentSearchResults = targetDB.filter(item => {
                const squishedBlob = item.searchBlob.replace(/[^a-z0-9]/g, '');
                return searchTokens.every(token => {
                    const squishedToken = token.replace(/[^a-z0-9]/g, '');
                    return squishedToken === '' ? true : squishedBlob.includes(squishedToken);
                });
            }).slice(0, 50);
        } else {
            // Provide a browsing preview if just selecting a catalog
            currentSearchResults = targetDB.slice(0, 50);
        }

        if (currentSearchResults.length === 0) {
            listEl.innerHTML = '<li class="autocomplete-item"><span class="hint">No matches found in this catalog.</span></li>';
        } else {
            currentSearchResults.forEach((item) => {
                const li = document.createElement('li');
                li.className = 'autocomplete-item';

                const nrTag = item.isNoRebate ? '<span class="badge badge-nr">NO REBATE</span>' : '';

                li.innerHTML = `
                    <div class="autocomplete-item-main">
                        <div class="autocomplete-item-title">${item.name} ${nrTag}</div>
                        <div class="hint">Catalog: ${escapeHtml(getCatalogLabel(item))}</div>
                    </div>
                    <div class="autocomplete-item-price">${formatINR(item.erp)}</div>
                `;

                li.onclick = () => addSpecificItemToQuote(item);
                listEl.appendChild(li);
            });
        }

        listEl.classList.add('active');
    }, 300);
}

function addSpecificItemToQuote(selectedItem) {
    const defaultDisc = parseFloat(document.getElementById('defaultDiscount').value) || 0;

    currentQuote.push({
        cartId: Date.now(),
        name: selectedItem.name,
        title: selectedItem.title || selectedItem.name,
        erp: selectedItem.erp,
        unitSell: selectedItem.unitSell,
        csvDiscPrice: selectedItem.csvDiscPrice,
        qty: 1,
        isNoRebate: selectedItem.isNoRebate,
        extraDiscPercent: selectedItem.isNoRebate ? 0 : defaultDisc,
        isMultiYear: false,
        yearDiscounts: [defaultDisc, defaultDisc, defaultDisc]
    });

    saveCart();
    renderUI();

    document.getElementById('searchName').value = '';
    document.getElementById('autocompleteResults').classList.remove('active');
    showToast('Added to quote', 'success');
}

// --- Cart Adjustments ---
function updateQty(id, value) {
    const item = currentQuote.find(i => i.cartId === id);
    if (item) {
        item.qty = value;
        if (item.qty < 1) item.qty = 1;
        saveCart();
        renderUI();
    }
}

function setDiscount(id, value) {
    const item = currentQuote.find(i => i.cartId === id);
    if (item && !item.isNoRebate) {
        let num = parseFloat(value);
        if (isNaN(num) || num < 0) num = 0;
        if (num > 100) num = 100;
        item.extraDiscPercent = num;
        saveCart();
        renderUI();
    }
}

// Toggles a single cart line between one flat discount and a 3-year discount breakup (same qty, no SKU duplication).
function toggleMultiYear(id) {
    if (!multiYearSplitEnabled) return;
    const item = currentQuote.find(i => i.cartId === id);
    if (!item || item.isNoRebate) return;
    item.isMultiYear = !item.isMultiYear;
    if (item.isMultiYear && !item.yearDiscounts) {
        item.yearDiscounts = [item.extraDiscPercent, item.extraDiscPercent, item.extraDiscPercent];
    }
    saveCart();
    renderUI();
}

function setYearDiscount(id, yearIndex, value) {
    const item = currentQuote.find(i => i.cartId === id);
    if (item && !item.isNoRebate) {
        let num = parseFloat(value);
        if (isNaN(num) || num < 0) num = 0;
        if (num > 100) num = 100;
        if (!item.yearDiscounts) item.yearDiscounts = [0, 0, 0];
        item.yearDiscounts[yearIndex] = num;
        saveCart();
        renderUI();
    }
}

// Shared pricing math for the builder table, generated quote, and saved-basket totals.
function computeItemTotals(item) {
    const baseUnitPrice = item.csvDiscPrice;
    if (item.isMultiYear && Array.isArray(item.yearDiscounts)) {
        // Divide each year's final sell price by the number of years so the 3-year sum matches
        // the original total instead of charging the full qty at full price in every year.
        const numYears = item.yearDiscounts.length;
        const yearPrices = item.yearDiscounts.map(disc =>
            (item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (disc / 100))) / numYears
        );
        const lineTotal = item.qty * yearPrices.reduce((sum, p) => sum + p, 0);
        return { baseUnitPrice, isMultiYear: true, yearPrices, lineTotal };
    }
    const finalUnitPrice = item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (item.extraDiscPercent / 100));
    const lineTotal = finalUnitPrice * item.qty;
    return { baseUnitPrice, isMultiYear: false, finalUnitPrice, lineTotal };
}

function removeItem(id) {
    currentQuote = currentQuote.filter(i => i.cartId !== id);
    saveCart();
    renderUI();
}

function clearCart() {
    currentQuote = [];
    saveCart();
    renderUI();
    showToast('Quote cleared');
}

function setTaxRate(value) {
    let num = parseFloat(value);
    if (isNaN(num) || num < 0) num = 0;
    taxRate = num;
    localStorage.setItem('taxRate', String(taxRate));
}

function setIncludeTax(isChecked) {
    includeTax = isChecked;
    localStorage.setItem('includeTax', String(includeTax));
}

function setPriceValidity(value) {
    priceValidityDate = value || getDefaultMonthEndDate();
    localStorage.setItem('priceValidityDate', priceValidityDate);
}

function setAdditionalConditions(value) {
    additionalConditions = value;
    localStorage.setItem('additionalConditions', additionalConditions);
}

function setMultiYearSplitEnabled(isChecked) {
    multiYearSplitEnabled = isChecked;
    localStorage.setItem('multiYearSplitEnabled', String(multiYearSplitEnabled));
    renderUI();
}

function saveQuote() {
    if (currentQuote.length === 0) {
        showToast('Cart is empty', 'error');
        return;
    }
    saveCurrentBasket();
    showToast('Quote saved', 'success');
}

function generateQuote() {
    if (currentQuote.length === 0) {
        showToast('Cart is empty', 'error');
        return;
    }
    saveCurrentBasket();
    renderEmailTable();
    document.getElementById('outputModal').classList.add('active');
}

// --- UI Renderers ---
function renderUI() {
    const tbody = document.getElementById('builderBody');
    const tfoot = document.getElementById('builderFooter');
    tbody.innerHTML = '';
    tfoot.innerHTML = '';

    if (currentQuote.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
            <p>Your quote is empty. Search above to add products.</p>
        </div></td></tr>`;
        return;
    }

    let grandTotal = 0;

    currentQuote.forEach(item => {
        const totals = computeItemTotals(item);
        grandTotal += totals.lineTotal;

        const nrTag = item.isNoRebate ? '<span class="badge badge-nr">NR</span>' : '';
        const disableInput = item.isNoRebate ? 'disabled title="Discounts locked"' : '';
        // Keep the "Use single discount" revert option visible even if the feature is later disabled in Settings, so existing split items stay editable.
        const multiYearBtn = (item.isNoRebate || !(multiYearSplitEnabled || item.isMultiYear)) ? '' : `<button type="button" class="link-btn" onclick="toggleMultiYear(${item.cartId})">${item.isMultiYear ? 'Use single discount' : 'Split into 3 years'}</button>`;

        let discCell, priceCell;
        if (totals.isMultiYear) {
            discCell = `
                <div class="year-disc-stack">
                    ${item.yearDiscounts.map((disc, i) => `
                        <div class="disc-wrapper">
                            <span class="year-label">Y${i + 1}</span>
                            <input type="number" value="${disc}" onchange="setYearDiscount(${item.cartId}, ${i}, this.value)" ${disableInput}>
                            <span style="font-size: 11px; color: var(--text-muted);">%</span>
                        </div>
                    `).join('')}
                </div>
            `;
            priceCell = `
                <div class="year-disc-stack">
                    ${totals.yearPrices.map((price, i) => `<div style="text-align: right;">Y${i + 1}: ${formatINR(price)}</div>`).join('')}
                </div>
            `;
        } else {
            discCell = `
                <div style="display: flex; justify-content: center;">
                    <div class="disc-wrapper">
                        <input type="number" value="${item.extraDiscPercent}" onchange="setDiscount(${item.cartId}, this.value)" ${disableInput}>
                        <span style="font-size: 11px; color: var(--text-muted);">%</span>
                    </div>
                </div>
            `;
            priceCell = `<span style="font-weight: 600; color: var(--brand-dark);">${formatINR(totals.finalUnitPrice)}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight: 500;">${item.name} ${nrTag}</div>${multiYearBtn}</td>
            <td style="text-align: right;">${formatINR(totals.baseUnitPrice)}</td>
            <td>${discCell}</td>
            <td style="text-align: right;">${priceCell}</td>
            <td>
                <div style="display: flex; justify-content: center;">
                    <div class="disc-wrapper">
                        <input type="number" class="qty-input" style="width: ${Math.max(String(item.qty).length + 2, 4)}ch;" value="${item.qty}" onchange="updateQty(${item.cartId}, this.value)" oninput="this.style.width = Math.max(this.value.length + 2, 4) + 'ch'">
                    </div>
                </div>
            </td>
            <td style="text-align: right; font-weight: 700;">${formatINR(totals.lineTotal)}${totals.isMultiYear ? '<div style="font-size: 10px; font-weight: 400; color: var(--text-muted);">3-yr total</div>' : ''}</td>
            <td style="text-align: center;">
                <button class="btn-icon" onclick="removeItem(${item.cartId})" title="Remove item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const footerRow = document.createElement('tr');
    footerRow.innerHTML = `
        <td colspan="4"></td>
        <td style="text-align: right; font-weight: 700;">Grand Total</td>
        <td style="text-align: right; font-weight: 700; color: var(--brand-dark);">${formatINR(grandTotal)}</td>
        <td></td>
    `;
    tfoot.appendChild(footerRow);
}

function renderEmailTable() {
    const outputArea = document.getElementById('emailOutputArea');
    if (currentQuote.length === 0) return;

    const showDiscColumn = currentQuote.some(item => item.isMultiYear || item.extraDiscPercent > 0);
    let rowsHTML = '';
    let grandTotal = 0;

    currentQuote.forEach(item => {
        const totals = computeItemTotals(item);
        grandTotal += totals.lineTotal;

        const displayDesc = item.title || item.name;

        if (totals.isMultiYear) {
            totals.yearPrices.forEach((price, i) => {
                const yearTotal = price * item.qty;
                let extraDiscCell = '';
                if (showDiscColumn) {
                    extraDiscCell = `<td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color: #F27222; font-weight: bold;">${formatINR(price)}</td>`;
                }
                rowsHTML += `
                    <tr>
                        <td style="border: 1px solid #e6e6e6; padding: 10px; font-size: 13px;">${displayDesc} <span style="color: #888;">(Year ${i + 1})</span></td>
                        <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right;">${formatINR(totals.baseUnitPrice)}</td>
                        ${extraDiscCell}
                        <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: center;">${item.qty}</td>
                        <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; font-weight: bold;">${formatINR(yearTotal)}</td>
                    </tr>
                `;
            });
            return;
        }

        let extraDiscCell = '';
        if (showDiscColumn) {
            const cellValue = (item.extraDiscPercent > 0 && !item.isNoRebate) ? formatINR(totals.finalUnitPrice) : formatINR(totals.baseUnitPrice);
            extraDiscCell = `<td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color: #F27222; font-weight: bold;">${cellValue}</td>`;
        }

        rowsHTML += `
            <tr>
                <td style="border: 1px solid #e6e6e6; padding: 10px; font-size: 13px;">${displayDesc}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right;">${formatINR(totals.baseUnitPrice)}</td>
                ${extraDiscCell}
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: center;">${item.qty}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; font-weight: bold;">${formatINR(totals.lineTotal)}</td>
            </tr>
        `;
    });

    const colSpanTotal = showDiscColumn ? 4 : 3;
    const taxAmount = includeTax ? grandTotal * (taxRate / 100) : 0;
    const finalTotal = grandTotal + taxAmount;

    outputArea.innerHTML = `
        <div style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc; padding: 20px 0;">
            <table style="border-collapse: collapse; width: 100%; max-width: 900px; font-family: Arial, sans-serif; font-size: 13px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: left; color: #333;">Description</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: right; color: #333;">Unit Price</th>
                        ${showDiscColumn ? '<th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: right; color: #333;">Discounted Price</th>' : ''}
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: center; color: #333;">Qty</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: right; color: #333;">Ext. Total</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
                <tfoot>
                    ${includeTax ? `
                    <tr>
                        <td colspan="${colSpanTotal}" style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; background-color: #fff;"><strong>Subtotal:</strong></td>
                        <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; background-color: #fff; color: #333;"><strong>${formatINR(grandTotal)}</strong></td>
                    </tr>
                    <tr>
                        <td colspan="${colSpanTotal}" style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; background-color: #fff;"><strong>Tax (${taxRate}%):</strong></td>
                        <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; background-color: #fff; color: #333;"><strong>${formatINR(taxAmount)}</strong></td>
                    </tr>` : ''}
                    <tr>
                        <td colspan="${colSpanTotal}" style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; background-color: #fff; font-size: 14px;"><strong>${includeTax ? 'Grand Total:' : 'Total:'}</strong></td>
                        <td style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; background-color: #fff; color: #990000; font-size: 15px;"><strong>${formatINR(finalTotal)}</strong></td>
                    </tr>
                </tfoot>
            </table>
            <div style="max-width: 900px; margin-top: 16px; font-family: Arial, sans-serif; font-size: 13px; color: #333;">
                <p style="margin: 4px 0;"><strong>Price Validity:</strong> Valid until ${formatDisplayDate(priceValidityDate)}</p>
                ${!includeTax ? '<p style="margin: 4px 0;"><strong>Taxes:</strong> Taxes extra.</p>' : ''}
                ${additionalConditions.trim() ? `<p style="margin: 4px 0; white-space: pre-wrap;"><strong>Additional Conditions:</strong> ${escapeHtml(additionalConditions.trim())}</p>` : ''}
            </div>
        </div>
    `;
}

function copyTable() {
    const outputArea = document.getElementById('emailOutputArea');
    try {
        const range = document.createRange();
        range.selectNodeContents(outputArea);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
        showToast("Table copied to clipboard!", "success");
    } catch (err) {
        showToast("Failed to copy table.", "error");
    }
}

// --- Parsing Logic ---
function processCSV() {
    if (typeof Papa === 'undefined') return alert("Error: papaparse.min.js is missing!");
    if (typeof XLSX === 'undefined') return alert("Error: xlsx.min.js is missing!");
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput.files.length) return alert("Please select a Master Rate Card file first.");

    const statusBadge = document.getElementById('uploadStatus');
    statusBadge.innerText = "Parsing data...";
    statusBadge.style.opacity = "1";
    statusBadge.className = "status-badge";

    let totalAdded = 0, totalFailed = 0, totalDuplicates = 0, totalReplaced = 0;

    function finalizeUpload() {
        statusBadge.innerHTML = `Loaded: ${totalAdded} | Replaced old: ${totalReplaced} | Skipped dupes: ${totalDuplicates} | Failed: ${totalFailed}`;
        statusBadge.className = totalAdded > 0 ? "status-badge status-success" : "status-badge status-error";
        updateMemoryDisplay();
        updateFileDropdown();
        renderDbPreview();

        localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
    }

    // Shared row-ingestion logic so both CSV (PapaParse) and Excel (SheetJS) sources
    // land in the same pricingDatabase schema.
    function ingestCatalogs(catalogs, file) {
        // Carry forward No-Rebate locks (matched by SKU/part IDs) so re-uploading an
        // updated price list doesn't silently unlock previously protected SKUs.
        const lockedSkuIds = new Set();
        pricingDatabase.forEach(item => {
            if (item.isNoRebate && item.rawSkuMatches) {
                item.rawSkuMatches.forEach(id => { if (id) lockedSkuIds.add(id); });
            }
        });

        // Refresh this catalog in full: replace stale rows instead of stacking
        // duplicate entries every time the same price list is re-uploaded.
        const beforeCount = pricingDatabase.length;
        pricingDatabase = pricingDatabase.filter(item => item.sourceFile !== file.name);
        totalReplaced += beforeCount - pricingDatabase.length;

        catalogs.forEach(({ rows, sourceSheet }) => ingestRows(rows, file, sourceSheet, lockedSkuIds));
    }

    function ingestRows(rows, file, sourceSheet, lockedSkuIds) {
        const seenInThisSheet = new Set();

        rows.forEach((row) => {
            const keyMap = {}; let searchBlobArray = []; let differentiatorArray = [];
            Object.keys(row).forEach(rawKey => {
                const val = row[rawKey] ? row[rawKey].toString().trim() : "";
                const cleanKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                keyMap[cleanKey] = rawKey;
                if (val) {
                    const isPriceColumn = cleanKey.match(/erp|listprice|unitsell|price|discountedprice|cost/);
                    if (!isPriceColumn) searchBlobArray.push(val.toLowerCase());
                    const isCoreColumn = cleanKey.match(/skutitle|producttitle|productname|description|skuid|productid|partnumber|publisher|changeindicator|itemnumber|sku/);
                    if (!isCoreColumn && !isPriceColumn && val.toLowerCase() !== "null" && val.toLowerCase() !== "na") {
                        differentiatorArray.push(val);
                    }
                }
            });

            const nameKey = keyMap['skutitle'] || keyMap['producttitle'] || keyMap['productname'] || keyMap['description'];
            const erpKey = keyMap['erp'] || keyMap['erpprice'] || keyMap['listprice'];
            const unitSellKey = keyMap['unitsellprice'] || keyMap['unitsell'] || keyMap['price'];
            const discPriceKey = keyMap['discountedprice'] || keyMap['discountprice'] || keyMap['cost'];
            const skuIdKey = findIdColumnKey(keyMap, SKU_ID_ALIASES);
            const productIdKey = findIdColumnKey(keyMap, PRODUCT_ID_ALIASES);
            const partNumberKey = findIdColumnKey(keyMap, PART_NUMBER_ALIASES);

            let validPriceKey = null;
            if (erpKey && row[erpKey] && parseMoneyString(row[erpKey]) > 0) validPriceKey = erpKey;
            else if (unitSellKey && row[unitSellKey] && parseMoneyString(row[unitSellKey]) > 0) validPriceKey = unitSellKey;
            else if (discPriceKey && row[discPriceKey] && parseMoneyString(row[discPriceKey]) > 0) validPriceKey = discPriceKey;
            else {
                if (erpKey && row[erpKey] && row[erpKey].toString().trim() !== "") validPriceKey = erpKey;
                else if (unitSellKey && row[unitSellKey] && row[unitSellKey].toString().trim() !== "") validPriceKey = unitSellKey;
                else if (discPriceKey && row[discPriceKey] && row[discPriceKey].toString().trim() !== "") validPriceKey = discPriceKey;
            }

            if (nameKey && validPriceKey) {
                const parsedBase = parseMoneyString(row[validPriceKey]);
                const parsedErp = (erpKey && row[erpKey]) ? parseMoneyString(row[erpKey]) : parsedBase;
                const parsedUnitSell = (unitSellKey && row[unitSellKey]) ? parseMoneyString(row[unitSellKey]) : parsedBase;
                const parsedDiscPrice = (discPriceKey && row[discPriceKey]) ? parseMoneyString(row[discPriceKey]) : parsedBase;

                let visualDisplayName = row[nameKey].trim();
                const displayIdKey = skuIdKey || productIdKey || partNumberKey;
                if (displayIdKey && row[displayIdKey]) visualDisplayName += ` [${row[displayIdKey].trim()}]`;
                if (differentiatorArray.length > 0) visualDisplayName += ` [${differentiatorArray.join(" | ")}]`;

                const rawSkuMatches = buildSkuMatchKeys(row, skuIdKey, productIdKey, partNumberKey);

                if (seenInThisSheet.has(visualDisplayName)) { totalDuplicates++; return; }
                seenInThisSheet.add(visualDisplayName);

                const isLocked = rawSkuMatches.some(id => id && lockedSkuIds.has(id));

                pricingDatabase.push({
                    id: Date.now() + Math.random(), sourceFile: file.name, sourceSheet, name: visualDisplayName, title: row[nameKey].trim(),
                    searchBlob: searchBlobArray.join(" "), rawSkuMatches: rawSkuMatches, erp: parsedErp, unitSell: parsedUnitSell,
                    csvDiscPrice: parsedDiscPrice, isNoRebate: isLocked
                });
                totalAdded++;
            } else totalFailed++;
        });
    }

    const files = Array.from(fileInput.files);
    let pendingFiles = files.length;
    const onFileDone = () => { pendingFiles--; if (pendingFiles === 0) finalizeUpload(); };

    files.forEach((file) => {
        const extension = file.name.toLowerCase().split('.').pop();

        if (extension === 'xlsx' || extension === 'xls') {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const workbook = XLSX.read(e.target.result, { type: 'array' });
                    const catalogs = workbook.SheetNames.map(sourceSheet => ({
                        sourceSheet,
                        rows: XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheet], { defval: '', raw: false, blankrows: false })
                    }));
                    ingestCatalogs(catalogs, file);
                } catch (err) {
                    console.error("Failed to parse Excel file " + file.name, err);
                    totalFailed++;
                }
                onFileDone();
            };
            reader.onerror = function () {
                console.error("Failed to read file " + file.name);
                totalFailed++;
                onFileDone();
            };
            reader.readAsArrayBuffer(file);
        } else {
            Papa.parse(file, {
                header: true, skipEmptyLines: true,
                complete: function (results) {
                    ingestCatalogs([{ rows: results.data, sourceSheet: null }], file);
                    onFileDone();
                }
            });
        }
    });
}

function updateMemoryDisplay() {
    document.getElementById('memoryStatus').innerText = `Total Loaded SKUs: ${pricingDatabase.length}`;
}

function getCatalogId(item) {
    return item.sourceSheet == null ? item.sourceFile : JSON.stringify([item.sourceFile, item.sourceSheet]);
}

function getCatalogLabel(item) {
    return item.sourceSheet == null ? item.sourceFile : `${item.sourceFile} - ${item.sourceSheet}`;
}

function updateFileDropdown() {
    const filterSelect = document.getElementById('fileFilter');
    const currentSelection = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">-- Search All Catalogs --</option>';
    const catalogs = new Map(pricingDatabase.map(item => [getCatalogId(item), getCatalogLabel(item)]));
    [...catalogs].sort((a, b) => a[1].localeCompare(b[1])).forEach(([catalogId, label]) => {
        const opt = document.createElement('option');
        opt.value = catalogId;
        opt.text = `Catalog: ${label}`;
        filterSelect.appendChild(opt);
    });
    if (catalogs.has(currentSelection)) filterSelect.value = currentSelection;
}

function renderDbPreview() {
    const tbody = document.getElementById('dbPreviewBody');
    tbody.innerHTML = '';
    if (pricingDatabase.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999; padding: 20px;">Database is currently empty. Upload a CSV above.</td></tr>';
        return;
    }
    const previewSet = pricingDatabase.slice(0, 100);
    previewSet.forEach(item => {
        const badge = item.isNoRebate ? '<span class="tag-nr">NO REBATE</span>' : '<span style="color:#666; font-size:10px;">Standard</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-size: 11px; color: #666;">${escapeHtml(getCatalogLabel(item))}</td>
            <td style="font-size: 12px; font-weight: bold;">${item.name}</td>
            <td>${formatINR(item.erp)}</td>
            <td>${formatINR(item.csvDiscPrice)}</td>
            <td>${badge}</td>
        `;
        tbody.appendChild(tr);
    });
}

function processNoRebateCSV() {
    if (pricingDatabase.length === 0) return showToast("Upload Master Rate Card first", "error", 5000);
    if (typeof XLSX === 'undefined') return alert("Error: xlsx.min.js is missing!");
    const nrFileInput = document.getElementById('nrFileInput');
    if (!nrFileInput.files.length) return alert("Select a No-Rebate file.");

    const nrStatus = document.getElementById('nrUploadStatus');
    nrStatus.innerText = "Scanning..."; nrStatus.style.opacity = "1";

    function ingestNoRebateRows(rows) {
        let flaggedCount = 0, failedMatchCount = 0, noIdColumnCount = 0;
        let loggedColumnsOnce = false;
        rows.forEach((row) => {
            const keyMap = {};
            Object.keys(row).forEach(k => { keyMap[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = k; });
            const skuIdKey = findIdColumnKey(keyMap, SKU_ID_ALIASES);
            const productIdKey = findIdColumnKey(keyMap, PRODUCT_ID_ALIASES);
            const partNumberKey = findIdColumnKey(keyMap, PART_NUMBER_ALIASES);

            if (!loggedColumnsOnce) {
                loggedColumnsOnce = true;
                console.log("No-Rebate file columns:", Object.keys(row), "-> detected as", { skuIdKey, productIdKey, partNumberKey });
            }

            const nrMatches = buildSkuMatchKeys(row, skuIdKey, productIdKey, partNumberKey);

            if (nrMatches.length > 0) {
                let matchFound = false;
                pricingDatabase.forEach(item => {
                    if (nrMatches.some(nrId => item.rawSkuMatches && item.rawSkuMatches.includes(nrId) && nrId !== "")) {
                        matchFound = true;
                        if (!item.isNoRebate) { item.isNoRebate = true; flaggedCount++; }
                    }
                });
                if (!matchFound) failedMatchCount++;
            } else {
                noIdColumnCount++;
                failedMatchCount++;
            }
        });

        localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
        if (rows.length > 0 && noIdColumnCount === rows.length) {
            nrStatus.innerHTML = `No SKU/Part/Product ID column recognized - check console`;
            console.warn("No-Rebate file has no recognizable identifier column. Columns found:", Object.keys(rows[0]));
        } else {
            nrStatus.innerHTML = `Locked: ${flaggedCount} | Unmatched: ${failedMatchCount}`;
        }
        nrStatus.className = flaggedCount > 0 ? "status-badge status-success" : "status-badge status-error";
        renderDbPreview();
        executeSearch();
    }

    const file = nrFileInput.files[0];
    const extension = file.name.toLowerCase().split('.').pop();

    if (extension === 'xlsx' || extension === 'xls') {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const workbook = XLSX.read(e.target.result, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false, blankrows: false });
                ingestNoRebateRows(rows);
            } catch (err) {
                console.error("Failed to parse Excel file " + file.name, err);
                nrStatus.innerHTML = "Failed to parse Excel file";
                nrStatus.className = "status-badge status-error";
            }
        };
        reader.onerror = function () {
            console.error("Failed to read file " + file.name);
            nrStatus.innerHTML = "Failed to read file";
            nrStatus.className = "status-badge status-error";
        };
        reader.readAsArrayBuffer(file);
    } else {
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: function (results) { ingestNoRebateRows(results.data); }
        });
    }
}

// --- Database & UI Helpers ---
function clearMemory() {
    if (confirm("CRITICAL WARNING: This will permanently wipe your saved pricing database from the browser's memory. Are you sure?")) {
        localStorage.removeItem('pricingDB');
        pricingDatabase = [];
        currentQuote = [];
        saveCart();
        document.getElementById('uploadStatus').innerText = "Awaiting upload...";
        document.getElementById('uploadStatus').className = "status-badge";
        document.getElementById('nrUploadStatus').innerText = "Awaiting cross-reference...";
        document.getElementById('nrUploadStatus').className = "status-badge";
        updateMemoryDisplay();
        updateFileDropdown();
        renderDbPreview();
        renderUI();
        executeSearch();
    }
}

function clearNoRebateSkus() {
    const nrCount = pricingDatabase.filter(item => item.isNoRebate).length;
    if (nrCount === 0) return showToast("No No-Rebate SKUs found in the database", "error", 5000);

    if (confirm(`This will remove ${nrCount} No-Rebate SKU(s) from the catalog, keeping everything else. Are you sure?`)) {
        pricingDatabase = pricingDatabase.filter(item => !item.isNoRebate);
        localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
        document.getElementById('nrUploadStatus').innerText = "Awaiting cross-reference...";
        document.getElementById('nrUploadStatus').className = "status-badge";
        updateMemoryDisplay();
        updateFileDropdown();
        renderDbPreview();
        renderUI();
        executeSearch();
        showToast(`Removed ${nrCount} No-Rebate SKU(s)`, "success", 5000);
    }
}

// --- Basket Management Logic ---

function persistCurrentBasketState() {
    localStorage.setItem('currentBasketId', currentBasketId);
    localStorage.setItem('currentBasketName', currentBasketName);
}

function setCurrentBasketName(value) {
    currentBasketName = value.trim() || "Untitled Quote";
    localStorage.setItem('currentBasketName', currentBasketName);
}

function saveCurrentBasket() {
    if (currentQuote.length === 0) return; // Don't save empty baskets

    const basketName = document.getElementById('basketNameInput').value.trim() || "Untitled Quote";
    setCurrentBasketName(basketName);

    // Check if we are updating an existing basket or making a new one
    const existingIndex = savedBaskets.findIndex(b => b.id === currentBasketId);
    
    const basketData = {
        id: currentBasketId,
        name: basketName,
        items: JSON.parse(JSON.stringify(currentQuote)), // Deep copy the cart
        updatedAt: Date.now()
    };

    if (existingIndex > -1) {
        savedBaskets[existingIndex] = basketData; // Update existing
    } else {
        savedBaskets.push(basketData); // Save new
    }

    localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
    renderSavedBaskets();
}

function loadBasket(basketId) {
    const basket = savedBaskets.find(b => b.id === basketId);
    if (!basket) return;

    currentBasketId = basket.id;
    currentBasketName = basket.name;
    document.getElementById('basketNameInput').value = basket.name;
    persistCurrentBasketState();

    // Replace the active cart with the saved items
    currentQuote = JSON.parse(JSON.stringify(basket.items));
    saveCart(); // Sync to your existing local storage
    renderUI();
    renderSavedBaskets(); // Re-render the list so the newly active basket gets highlighted
    showToast(`Loaded: ${basket.name}`, 'success');
}

function duplicateBasket(basketId, event) {
    event.stopPropagation(); // Prevents the click from triggering loadBasket

    const basket = savedBaskets.find(b => b.id === basketId);
    if (!basket) return;

    savedBaskets.push({
        id: Date.now().toString(),
        name: `${basket.name} (Copy)`,
        items: JSON.parse(JSON.stringify(basket.items)),
        updatedAt: Date.now()
    });

    localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
    renderSavedBaskets();
    showToast(`Duplicated: ${basket.name}`, 'success');
}

function deleteBasket(basketId, event) {
    event.stopPropagation(); // Prevents the click from triggering loadBasket
    
    if (confirm("Are you sure you want to delete this saved quote?")) {
        savedBaskets = savedBaskets.filter(b => b.id !== basketId);
        selectedBasketIds.delete(basketId);
        localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
        renderSavedBaskets();
        
        // If they delete the basket they are currently looking at, wipe the screen
        if (currentBasketId === basketId) {
            startNewBasket();
        }
    }
}

function toggleBasketSelection(basketId, event) {
    event.stopPropagation(); // Prevents the click from triggering loadBasket
    if (selectedBasketIds.has(basketId)) selectedBasketIds.delete(basketId);
    else selectedBasketIds.add(basketId);
    renderSavedBaskets();
}

function toggleSelectAllBaskets(event) {
    event.stopPropagation();
    const searchInput = document.getElementById('basketSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const visibleBaskets = savedBaskets.filter(b => !searchTerm || b.name.toLowerCase().includes(searchTerm));

    if (visibleBaskets.every(b => selectedBasketIds.has(b.id))) {
        visibleBaskets.forEach(b => selectedBasketIds.delete(b.id));
    } else {
        visibleBaskets.forEach(b => selectedBasketIds.add(b.id));
    }
    renderSavedBaskets();
}

function deleteSelectedBaskets() {
    if (selectedBasketIds.size === 0) return;

    if (confirm(`Are you sure you want to delete ${selectedBasketIds.size} selected quote(s)?`)) {
        const deletingCurrent = selectedBasketIds.has(currentBasketId);
        savedBaskets = savedBaskets.filter(b => !selectedBasketIds.has(b.id));
        selectedBasketIds.clear();
        localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
        renderSavedBaskets();

        if (deletingCurrent) startNewBasket();
    }
}

function startNewBasket() {
    currentBasketId = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    currentBasketName = getNextQuoteName();
    document.getElementById('basketNameInput').value = currentBasketName;
    persistCurrentBasketState();
    clearCart(); // Your existing function
    renderSavedBaskets();
}

function calculateBasketTotal(items) {
    return items.reduce((sum, item) => sum + computeItemTotals(item).lineTotal, 0);
}

function exportSavedBaskets() {
    const basketsToExport = selectedBasketIds.size > 0
        ? savedBaskets.filter(b => selectedBasketIds.has(b.id))
        : savedBaskets;

    if (basketsToExport.length === 0) {
        showToast('No saved quotes to export', 'error');
        return;
    }
    const blob = new Blob([JSON.stringify(basketsToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved-quotes-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`${basketsToExport.length} saved quote(s) exported`, 'success');
}

function importSavedBaskets(file) {
    if (!file) return;
    const inputEl = document.getElementById('importBasketsInput');

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) throw new Error('Invalid format');

            let addedCount = 0;
            imported.forEach(basket => {
                if (!basket || !Array.isArray(basket.items)) return;
                savedBaskets.push({
                    id: Date.now().toString() + Math.random().toString(36).slice(2, 7), // avoid clashing with existing quote ids
                    name: basket.name || 'Imported Quote',
                    items: basket.items,
                    updatedAt: basket.updatedAt || Date.now()
                });
                addedCount++;
            });

            if (addedCount === 0) {
                showToast('No valid quotes found in file', 'error');
                return;
            }

            localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
            renderSavedBaskets();
            showToast(`Imported ${addedCount} quote(s)`, 'success');
        } catch (err) {
            showToast('Failed to import: invalid file', 'error');
        } finally {
            if (inputEl) inputEl.value = '';
        }
    };
    reader.readAsText(file);
}

function renderSavedBaskets() {
    const list = document.getElementById('savedBasketsList');
    list.innerHTML = '';

    // Drop selections for any quotes that no longer exist, then sync the bulk toolbar controls
    const validIds = new Set(savedBaskets.map(b => b.id));
    selectedBasketIds.forEach(id => { if (!validIds.has(id)) selectedBasketIds.delete(id); });

    const searchInput = document.getElementById('basketSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const visibleBaskets = savedBaskets.filter(b => !searchTerm || b.name.toLowerCase().includes(searchTerm));

    const selectAllCheckbox = document.getElementById('selectAllBaskets');
    const selectedLabel = document.getElementById('selectedBasketsLabel');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBasketsBtn');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = visibleBaskets.length > 0 && visibleBaskets.every(b => selectedBasketIds.has(b.id));
        selectAllCheckbox.disabled = visibleBaskets.length === 0;
    }
    if (selectedLabel) selectedLabel.textContent = selectedBasketIds.size > 0 ? `${selectedBasketIds.size} selected` : 'Select all';
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = selectedBasketIds.size === 0;

    if (savedBaskets.length === 0) {
        list.innerHTML = '<li><span class="hint">No saved quotes yet.</span></li>';
        return;
    }
    if (visibleBaskets.length === 0) {
        list.innerHTML = '<li><span class="hint">No saved quotes match your search.</span></li>';
        return;
    }

    // Sort so the most recently updated quotes are at the top
    visibleBaskets.sort((a, b) => b.updatedAt - a.updatedAt).forEach(basket => {
        const li = document.createElement('li');
        li.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px 12px; border: 1px solid var(--border-light);
            border-radius: var(--radius-md); background: var(--bg-card);
            cursor: pointer; transition: all 0.2s ease;
        `;
        
        // Highlight the active basket
        if (basket.id === currentBasketId) {
            li.style.borderColor = 'var(--brand-orange)';
            li.style.backgroundColor = 'var(--brand-orange-light)';
        }

        li.onclick = () => loadBasket(basket.id);
        
        li.innerHTML = `
            <input type="checkbox" onclick="toggleBasketSelection('${basket.id}', event)" ${selectedBasketIds.has(basket.id) ? 'checked' : ''}
                style="width: 16px; height: 16px; accent-color: var(--brand-orange); cursor: pointer; flex-shrink: 0; margin-right: 10px;">
            <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: 600; font-size: 0.85rem; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; color: var(--brand-dark);">${basket.name}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${basket.items.length} items &middot; ${formatINR(calculateBasketTotal(basket.items))}</div>
            </div>
            <div style="display: flex; gap: 2px;">
                <button class="btn-icon" onclick="duplicateBasket('${basket.id}', event)" title="Duplicate" style="padding: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="btn-icon" onclick="deleteBasket('${basket.id}', event)" title="Delete" style="color: var(--danger); padding: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
        list.appendChild(li);
    });
}
