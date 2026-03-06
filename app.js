'use strict';

// --- State Management ---
let pricingDatabase = JSON.parse(localStorage.getItem('pricingDB')) || [];
let currentQuote = JSON.parse(localStorage.getItem('quoteCart')) || [];
let sheetUrls = JSON.parse(localStorage.getItem('savedSheetUrls')) || [];
let lastSyncTime = parseInt(localStorage.getItem('lastSheetSyncTime')) || 0;
let currentSearchResults = [];
// Add this timer variable to the top of your app.js state management
let searchTimeout = null;
let savedBaskets = JSON.parse(localStorage.getItem('savedQuotesDatabase')) || [];
let currentBasketId = Date.now().toString(); // Assigns a unique ID to the active session

let taxRate = parseFloat(localStorage.getItem('taxRate'));
if (isNaN(taxRate)) taxRate = 18;
let includeTax = localStorage.getItem('includeTax') !== 'false';

// --- Initialization (Fixed: Runs immediately instead of waiting for delayed DOM signal) ---
function initApp() {
    updateMemoryDisplay();
    updateFileDropdown();
    renderDbPreview();
    // toggleControlSidebar(); // Start with sidebar collapsed
    renderUI(); // Forces cart to load from localStorage immediately

    renderSheetManager();
    checkDailySync();

    renderSavedBaskets();

    const taxInput = document.getElementById('taxRate');
    if (taxInput) taxInput.value = taxRate;

    const taxCheck = document.getElementById('includeTax');
    if (taxCheck) taxCheck.checked = includeTax;

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

function parseMoneyString(str) {
    if (!str) return 0;
    const cleaned = parseFloat(str.toString().replace(/[^0-9.-]+/g, ""));
    return isNaN(cleaned) ? 0 : cleaned;
}

function cleanStringForMatch(str) {
    if (!str) return "";
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

        let targetDB = activeCatalog !== 'all' ? pricingDatabase.filter(i => i.sourceFile === activeCatalog) : pricingDatabase;

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
                        <div class="hint">Catalog: ${item.sourceFile}</div>
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
        extraDiscPercent: selectedItem.isNoRebate ? 0 : defaultDisc
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
    tbody.innerHTML = '';

    if (currentQuote.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
            <p>Your quote is empty. Search above to add products.</p>
        </div></td></tr>`;
        return;
    }

    currentQuote.forEach(item => {
        const baseUnitPrice = item.csvDiscPrice;
        const finalUnitPrice = item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (item.extraDiscPercent / 100));
        const lineTotal = finalUnitPrice * item.qty;

        const nrTag = item.isNoRebate ? '<span class="badge badge-nr">NR</span>' : '';
        const disableInput = item.isNoRebate ? 'disabled title="Discounts locked"' : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight: 500;">${item.name} ${nrTag}</div></td>
            <td style="text-align: right; color: var(--text-muted);">${formatINR(item.erp)}</td>
            <td style="text-align: right;">${formatINR(baseUnitPrice)}</td>
            <td>
                <div style="display: flex; justify-content: center;">
                    <div class="disc-wrapper">
                        <input type="number" value="${item.extraDiscPercent}" onchange="setDiscount(${item.cartId}, this.value)" ${disableInput}>
                        <span style="font-size: 11px; color: var(--text-muted);">%</span>
                    </div>
                </div>
            </td>
            <td style="text-align: right; font-weight: 600; color: var(--brand-dark);">${formatINR(finalUnitPrice)}</td>
            <td>
                <div style="display: flex; justify-content: center;">
                    <div class="disc-wrapper">
                        <input type="number" value="${item.qty}" onchange="updateQty(${item.cartId}, this.value)">
                    </div>
                </div>
            </td>
            <td style="text-align: right; font-weight: 700;">${formatINR(lineTotal)}</td>
            <td style="text-align: center;">
                <button class="btn-icon" onclick="removeItem(${item.cartId})" title="Remove item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEmailTable() {
    const outputArea = document.getElementById('emailOutputArea');
    if (currentQuote.length === 0) return;

    const showDiscColumn = currentQuote.some(item => item.extraDiscPercent > 0);
    let rowsHTML = '';
    let grandTotal = 0;

    currentQuote.forEach(item => {
        const baseUnitPrice = item.csvDiscPrice;
        const finalUnitPrice = item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (item.extraDiscPercent / 100));
        const lineTotal = finalUnitPrice * item.qty;
        grandTotal += lineTotal;

        const displayDesc = item.title || item.name;

        let extraDiscCell = '';
        if (showDiscColumn) {
            const cellValue = (item.extraDiscPercent > 0 && !item.isNoRebate) ? formatINR(finalUnitPrice) : formatINR(baseUnitPrice);
            extraDiscCell = `<td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color: #F27222; font-weight: bold;">${cellValue}</td>`;
        }

        rowsHTML += `
            <tr>
                <td style="border: 1px solid #e6e6e6; padding: 10px; font-size: 13px;">${displayDesc}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color:#666;">${formatINR(item.erp)}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right;">${formatINR(baseUnitPrice)}</td>
                ${extraDiscCell}
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: center;">${item.qty}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; font-weight: bold;">${formatINR(lineTotal)}</td>
            </tr>
        `;
    });

    const colSpanTotal = showDiscColumn ? 5 : 4;
    const taxAmount = includeTax ? grandTotal * (taxRate / 100) : 0;
    const finalTotal = grandTotal + taxAmount;

    outputArea.innerHTML = `
        <div style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc; padding: 20px 0;">
            <table style="border-collapse: collapse; width: 100%; max-width: 900px; font-family: Arial, sans-serif; font-size: 13px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: left; color: #333;">Description</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; background-color: #f8f9fa; text-align: right; color: #333;">ERP Price</th>
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

// --- Parsing Logic (Kept identical to protect the engine) ---
function processCSV() {
    if (typeof Papa === 'undefined') return alert("Error: papaparse.min.js is missing!");
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput.files.length) return alert("Please select a Master Rate Card CSV first.");

    const statusBadge = document.getElementById('uploadStatus');
    statusBadge.innerText = "Parsing data...";
    statusBadge.style.opacity = "1";
    statusBadge.className = "status-badge";

    let totalAdded = 0, totalFailed = 0, totalDuplicates = 0;

    Array.from(fileInput.files).forEach((file, index) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: function (results) {
                results.data.forEach((row) => {
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
                    const skuIdKey = keyMap['skuid'] || keyMap['sku'];
                    const productIdKey = keyMap['productid'] || keyMap['itemnumber'];
                    const partNumberKey = keyMap['partnumber'];

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

                        const rawSkuMatches = [];
                        if (skuIdKey && row[skuIdKey]) rawSkuMatches.push(cleanStringForMatch(row[skuIdKey]));
                        if (productIdKey && row[productIdKey]) rawSkuMatches.push(cleanStringForMatch(row[productIdKey]));
                        if (partNumberKey && row[partNumberKey]) rawSkuMatches.push(cleanStringForMatch(row[partNumberKey]));

                        const isDuplicate = pricingDatabase.some(item => item.name === visualDisplayName && item.erp === parsedErp);
                        if (isDuplicate) totalDuplicates++;
                        else {
                            pricingDatabase.push({
                                id: Date.now() + Math.random(), sourceFile: file.name, name: visualDisplayName, title: row[nameKey].trim(),
                                searchBlob: searchBlobArray.join(" "), rawSkuMatches: rawSkuMatches, erp: parsedErp, unitSell: parsedUnitSell,
                                csvDiscPrice: parsedDiscPrice, isNoRebate: false
                            });
                            totalAdded++;
                        }
                    } else totalFailed++;
                });

                statusBadge.innerHTML = `Loaded: ${totalAdded} | Dupes: ${totalDuplicates} | Failed: ${totalFailed}`;
                statusBadge.className = totalAdded > 0 ? "status-badge status-success" : "status-badge status-error";
                updateMemoryDisplay();
                updateFileDropdown();
                renderDbPreview();

                localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
            }
        });
    });
}

function updateMemoryDisplay() {
    document.getElementById('memoryStatus').innerText = `Total Loaded SKUs: ${pricingDatabase.length}`;
}

function updateFileDropdown() {
    const filterSelect = document.getElementById('fileFilter');
    const currentSelection = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">-- Search All Catalogs --</option>';
    const uniqueFiles = [...new Set(pricingDatabase.map(item => item.sourceFile))].sort();
    uniqueFiles.forEach(fileName => {
        const opt = document.createElement('option');
        opt.value = fileName;
        opt.text = `Catalog: ${fileName}`;
        filterSelect.appendChild(opt);
    });
    if (uniqueFiles.includes(currentSelection)) filterSelect.value = currentSelection;
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
            <td style="font-size: 11px; color: #666;">${item.sourceFile}</td>
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
    const nrFileInput = document.getElementById('nrFileInput');
    if (!nrFileInput.files.length) return alert("Select a No-Rebate CSV file.");

    const nrStatus = document.getElementById('nrUploadStatus');
    nrStatus.innerText = "Scanning..."; nrStatus.style.opacity = "1";

    Papa.parse(nrFileInput.files[0], {
        header: true, skipEmptyLines: true,
        complete: function (results) {
            let flaggedCount = 0, failedMatchCount = 0;
            results.data.forEach((row) => {
                const keyMap = {};
                Object.keys(row).forEach(k => { keyMap[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = k; });
                const skuIdKey = keyMap['skuid'] || keyMap['sku'];
                const productIdKey = keyMap['productid'] || keyMap['itemnumber'];
                const partNumberKey = keyMap['partnumber'];

                const nrMatches = [];
                if (skuIdKey && row[skuIdKey]) nrMatches.push(cleanStringForMatch(row[skuIdKey]));
                if (productIdKey && row[productIdKey]) nrMatches.push(cleanStringForMatch(row[productIdKey]));
                if (partNumberKey && row[partNumberKey]) nrMatches.push(cleanStringForMatch(row[partNumberKey]));

                if (nrMatches.length > 0) {
                    let matchFound = false;
                    pricingDatabase.forEach(item => {
                        if (nrMatches.some(nrId => item.rawSkuMatches && item.rawSkuMatches.includes(nrId) && nrId !== "")) {
                            matchFound = true;
                            if (!item.isNoRebate) { item.isNoRebate = true; flaggedCount++; }
                        }
                    });
                    if (!matchFound) failedMatchCount++;
                } else failedMatchCount++;
            });

            localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
            nrStatus.innerHTML = `Locked: ${flaggedCount} | Unmatched: ${failedMatchCount}`;
            nrStatus.className = flaggedCount > 0 ? "status-badge status-success" : "status-badge status-error";
            renderDbPreview();
            executeSearch();
        }
    });
}

function checkDailySync() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // If it has been more than 24 hours since the last sync, trigger it automatically.
    if (sheetUrls.length > 0 && (now - lastSyncTime > oneDay)) {
        console.log("24 hours passed since last sync. Executing background pull...");
        syncAllSheets();
    }
}

function addSheetUrl() {
    const input = document.getElementById('newSheetUrl');
    const url = input.value.trim();
    if (!url) return showToast("Please enter a URL", "error");

    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return showToast("Invalid Google Sheets URL format.", "error");

    const sheetId = idMatch[1];

    if (sheetUrls.some(s => s.id === sheetId)) {
        return showToast("This sheet is already in your manager.", "error");
    }

    sheetUrls.push({ id: sheetId, url: url, addedAt: Date.now() });
    localStorage.setItem('savedSheetUrls', JSON.stringify(sheetUrls));

    input.value = '';
    renderSheetManager();
    showToast("Link saved. Click 'Sync All' to pull data.", "success");
}

function removeSheetUrl(sheetId) {
    sheetUrls = sheetUrls.filter(s => s.id !== sheetId);
    localStorage.setItem('savedSheetUrls', JSON.stringify(sheetUrls));
    renderSheetManager();

    if (confirm("Link removed. Do you want to purge the existing pricing data associated with this sheet?")) {
        // Keeps manually uploaded CSVs and other sheets intact
        pricingDatabase = pricingDatabase.filter(item => item.sourceFile !== `CloudSheet_${sheetId}`);
        localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
        updateMemoryDisplay();
        updateFileDropdown();
        renderDbPreview();
    }
}

function renderSheetManager() {
    const list = document.getElementById('savedSheetsList');
    list.innerHTML = '';

    if (sheetUrls.length === 0) {
        list.innerHTML = '<li><span class="hint" style="color: var(--text-muted);">No cloud sheets configured.</span></li>';
        return;
    }

    sheetUrls.forEach(sheet => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '8px 0';
        li.style.borderBottom = '1px solid #fde6d5';

        li.innerHTML = `
            <div style="font-size: 0.8rem; width: 85%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);" title="${sheet.url}">
                <strong>ID:</strong> ${sheet.id.substring(0, 20)}...
            </div>
            <button class="btn btn-icon" onclick="removeSheetUrl('${sheet.id}')" title="Remove Link" style="color: var(--danger); border: 1px solid transparent;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;
        list.appendChild(li);
    });
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

async function syncAllSheets() {
    if (typeof Papa === 'undefined') return alert("PapaParse is missing!");
    if (sheetUrls.length === 0) return showToast("No sheets configured to sync.", "error");

    const statusBadge = document.getElementById('sheetSyncStatus');
    statusBadge.innerText = "Pulling data...";
    statusBadge.style.opacity = "1";
    statusBadge.className = "status-badge";

    // Isolate manual CSV uploads from cloud data. 
    // We wipe out old cloud data to prevent duplicating records on every sync.
    const staticDb = pricingDatabase.filter(item => !item.sourceFile.startsWith('CloudSheet_'));
    let newDynamicDb = [];
    let totalAdded = 0;

    // Create an array of network requests
    const fetchPromises = sheetUrls.map(sheet => {
        return new Promise((resolve) => {
            const cacheBuster = Date.now();
            const csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv&cb=${cacheBuster}`;

            // New code inside fetchPromises
            //const cacheBuster = Date.now();
            //const baseGoogleUrl = `https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv&cb=${cacheBuster}`;

            // Route the request through AllOrigins, a free CORS proxy, to bypass browser security blocks
            //const csvExportUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(baseGoogleUrl)}`;

            Papa.parse(csvExportUrl, {
                download: true, header: true, skipEmptyLines: true,
                error: function (err) {
                    console.error("Failed to fetch sheet " + sheet.id, err);
                    resolve(0); // Resolve 0 so Promise.all doesn't crash the whole batch
                },
                complete: function (results) {
                    let sheetAdded = 0;
                    results.data.forEach((row) => {
                        const keyMap = {};
                        let searchBlobArray = [];
                        let differentiatorArray = [];

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
                        const skuIdKey = keyMap['skuid'] || keyMap['sku'];
                        const productIdKey = keyMap['productid'] || keyMap['itemnumber'];
                        const partNumberKey = keyMap['partnumber'];

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

                            const rawSkuMatches = [];
                            if (skuIdKey && row[skuIdKey]) rawSkuMatches.push(cleanStringForMatch(row[skuIdKey]));
                            if (productIdKey && row[productIdKey]) rawSkuMatches.push(cleanStringForMatch(row[productIdKey]));
                            if (partNumberKey && row[partNumberKey]) rawSkuMatches.push(cleanStringForMatch(row[partNumberKey]));

                            newDynamicDb.push({
                                id: Date.now() + Math.random(),
                                sourceFile: `CloudSheet_${sheet.id.substring(0, 8)}`, // Tags as dynamic
                                name: visualDisplayName,
                                title: row[nameKey].trim(),
                                searchBlob: searchBlobArray.join(" "),
                                rawSkuMatches: rawSkuMatches,
                                erp: parsedErp,
                                unitSell: parsedUnitSell,
                                csvDiscPrice: parsedDiscPrice,
                                isNoRebate: false
                            });
                            sheetAdded++;
                        }
                    });
                    resolve(sheetAdded);
                }
            });
        });
    });

    // Wait for all sheets to finish downloading and parsing
    const results = await Promise.all(fetchPromises);
    results.forEach(count => { totalAdded += count; });

    // Merge the untouched static CSV data with the freshly pulled dynamic sheet data
    pricingDatabase = [...staticDb, ...newDynamicDb];
    localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));

    // Update the last sync clock
    lastSyncTime = Date.now();
    localStorage.setItem('lastSheetSyncTime', lastSyncTime.toString());

    statusBadge.innerHTML = `Synced ${totalAdded} fresh items`;
    statusBadge.className = totalAdded > 0 ? "status-badge status-success" : "status-badge status-error";

    updateMemoryDisplay();
    updateFileDropdown();
    renderDbPreview();
    showToast("All cloud sheets synchronized", "success");
}

// --- Basket Management Logic ---

function saveCurrentBasket() {
    if (currentQuote.length === 0) return; // Don't save empty baskets

    const basketName = document.getElementById('basketNameInput').value.trim() || "Untitled Quote";
    
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
    document.getElementById('basketNameInput').value = basket.name;
    
    // Replace the active cart with the saved items
    currentQuote = JSON.parse(JSON.stringify(basket.items));
    saveCart(); // Sync to your existing local storage
    renderUI();
    showToast(`Loaded: ${basket.name}`, 'success');
}

function deleteBasket(basketId, event) {
    event.stopPropagation(); // Prevents the click from triggering loadBasket
    
    if (confirm("Are you sure you want to delete this saved quote?")) {
        savedBaskets = savedBaskets.filter(b => b.id !== basketId);
        localStorage.setItem('savedQuotesDatabase', JSON.stringify(savedBaskets));
        renderSavedBaskets();
        
        // If they delete the basket they are currently looking at, wipe the screen
        if (currentBasketId === basketId) {
            startNewBasket();
        }
    }
}

function startNewBasket() {
    currentBasketId = Date.now().toString();
    document.getElementById('basketNameInput').value = "Untitled Quote";
    clearCart(); // Your existing function
}

function renderSavedBaskets() {
    const list = document.getElementById('savedBasketsList');
    list.innerHTML = '';
    
    if (savedBaskets.length === 0) {
        list.innerHTML = '<li><span class="hint">No saved quotes yet.</span></li>';
        return;
    }

    // Sort so the most recently updated quotes are at the top
    savedBaskets.sort((a, b) => b.updatedAt - a.updatedAt).forEach(basket => {
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
            <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: 600; font-size: 0.85rem; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; color: var(--brand-dark);">${basket.name}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${basket.items.length} items</div>
            </div>
            <button class="btn-icon" onclick="deleteBasket('${basket.id}', event)" title="Delete" style="color: var(--danger); padding: 4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;
        list.appendChild(li);
    });
}


