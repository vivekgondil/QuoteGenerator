/* app.js — extracted and lightly documented from pricing.html
   Keeps original public function names because HTML uses inline onclick attributes.
*/
'use strict';

// --- State Management ---
let pricingDatabase = JSON.parse(localStorage.getItem('pricingDB')) || [];
let currentQuote = JSON.parse(localStorage.getItem('quoteCart')) || [];
let currentSearchResults = [];
// Tax rate (percent) persisted in localStorage
let taxRate = parseFloat(localStorage.getItem('taxRate'));
if (isNaN(taxRate)) taxRate = 18;
// Tax inclusion toggle persisted in localStorage
let includeTax = localStorage.getItem('includeTax') !== 'false';
// Default to true if not set

// Initialize UI
updateMemoryDisplay();
updateFileDropdown();
renderDbPreview();
// initialize tax input if present (keeps UI in sync with saved setting)
const taxInput = document.getElementById('taxRate');
if (taxInput) {
    taxInput.value = taxRate;
    taxInput.onchange = function (e) { setTaxRate(e.target.value); };
}
// initialize tax toggle checkbox
const includeTaxCheckbox = document.getElementById('includeTax');
if (includeTaxCheckbox) {
    includeTaxCheckbox.checked = includeTax;
    includeTaxCheckbox.onchange = function (e) { setIncludeTax(e.target.checked); };
}
renderUI(); // Render cart on load

// restore sidebar collapsed state (persisted)
(function restoreSidebarState(){
    const controlSidebarEl = document.getElementById('controlSidebar');
    if (!controlSidebarEl) return;
    const wasCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (wasCollapsed) controlSidebarEl.classList.add('collapsed');
})();

// --- Tab Switching ---
function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(section => section.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.getElementById('btn-' + tabId).classList.add('active');
}

function openDatabasePane() {
    document.getElementById('databasePane').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeDatabasePane() {
    document.getElementById('databasePane').classList.add('hidden');
    document.body.style.overflow = 'auto';
}

function generateQuote() {
    if (currentQuote.length === 0) {
        alert('Please add items to your quote first.');
        return;
    }
    renderEmailTable();
    document.getElementById('outputModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeOutputModal() {
    document.getElementById('outputModal').classList.add('hidden');
    document.body.style.overflow = 'auto';
}

function toggleControlSidebar() {
    const el = document.getElementById('controlSidebar');
    if (!el) return;
    const collapsed = el.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', String(collapsed));
}

// --- Core Utilities ---
function formatINR(number) {
    return "₹&nbsp;" + number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// --- 1. Master Catalog Parser (Waterfall Logic) ---
function processCSV() {
    if (typeof Papa === 'undefined') return alert("Error: papaparse.min.js is missing!");
    const fileInput = document.getElementById('csvFileInput');
    if (!fileInput.files.length) return alert("Please select a Master Rate Card CSV first.");

    const statusBadge = document.getElementById('uploadStatus');
    statusBadge.innerText = "Parsing data...";
    statusBadge.className = "status-badge";

    let totalAdded = 0;
    let totalFailed = 0;
    let totalDuplicates = 0;

    console.clear();
    console.log("--- STARTING MASTER CSV UPLOAD ---");

    Array.from(fileInput.files).forEach((file, index) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: function (results) {
                if (results.data.length > 0) {
                    console.log(`Detected Headers in ${file.name}:`, Object.keys(results.data[0]));
                }

                results.data.forEach((row, rowNum) => {
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

                    // Waterfall price selection: prefer positive numeric; otherwise accept first non-empty price field
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

                        let visualDisplayName = "";

                        // Start with the title/product name
                        visualDisplayName += row[nameKey].trim();

                        // Append IDs
                        const displayIdKey = skuIdKey || productIdKey || partNumberKey;
                        if (displayIdKey && row[displayIdKey]) {
                            visualDisplayName += ` [${row[displayIdKey].trim()}]`;
                        }

                        // Append differentiators at the end
                        if (differentiatorArray.length > 0) visualDisplayName += ` [${differentiatorArray.join(" | ")}]`;

                        const rawSkuMatches = [];
                        if (skuIdKey && row[skuIdKey]) rawSkuMatches.push(cleanStringForMatch(row[skuIdKey]));
                        if (productIdKey && row[productIdKey]) rawSkuMatches.push(cleanStringForMatch(row[productIdKey]));
                        if (partNumberKey && row[partNumberKey]) rawSkuMatches.push(cleanStringForMatch(row[partNumberKey]));

                        const massiveSearchBlob = searchBlobArray.join(" ");
                        const isDuplicate = pricingDatabase.some(item => item.name === visualDisplayName && item.erp === parsedErp);
                        console.log(`${visualDisplayName}`);
                        if (isDuplicate) {
                            totalDuplicates++;
                        } else {
                            pricingDatabase.push({
                                id: Date.now() + Math.random(),
                                sourceFile: file.name,
                                name: visualDisplayName,
                                title: row[nameKey].trim(),
                                searchBlob: massiveSearchBlob,
                                rawSkuMatches: rawSkuMatches,
                                erp: parsedErp,
                                unitSell: parsedUnitSell,
                                csvDiscPrice: parsedDiscPrice,
                                isNoRebate: false
                            });
                            totalAdded++;
                        }
                    } else {
                        totalFailed++;
                        if (totalFailed < 10) console.warn(`Row ${rowNum + 2} Failed: Missing Name or Valid Price.`, row);
                    }
                });

                localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));

                if (index === fileInput.files.length - 1) {
                    statusBadge.innerHTML = `Processed ${results.data.length} rows. <span style="color:green;">${totalAdded} Added</span> | <span style="color:orange;">${totalDuplicates} Skipped (Dupe)</span> | <span style="color:red;">${totalFailed} Failed</span>`;
                    statusBadge.className = totalAdded > 0 ? "status-badge status-success" : "status-badge status-error";
                    console.log(`--- UPLOAD COMPLETE. Database contains ${pricingDatabase.length} items. ---`);
                    updateMemoryDisplay();
                    updateFileDropdown();
                    renderDbPreview();
                }
            }
        });
    });
}

// --- 2. No-Rebate Cross-Reference Parser ---
function processNoRebateCSV() {
    if (pricingDatabase.length === 0) return alert("You must upload a Master Rate Card before applying No-Rebate rules.");
    const nrFileInput = document.getElementById('nrFileInput');
    if (!nrFileInput.files.length) return alert("Please select a No-Rebate CSV file.");

    const nrStatus = document.getElementById('nrUploadStatus');
    nrStatus.innerText = "Scanning database...";
    nrStatus.className = "status-badge";

    const file = nrFileInput.files[0];
    console.log("--- STARTING NO-REBATE CROSS REFERENCE ---");

    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: function (results) {
            let flaggedCount = 0;
            let failedMatchCount = 0;

            if (results.data.length > 0) {
                console.log("Detected Headers in No-Rebate File:", Object.keys(results.data[0]));
            }

            results.data.forEach((row, index) => {
                const keyMap = {};
                Object.keys(row).forEach(k => {
                    const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                    keyMap[cleanKey] = k;
                });

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
                        const isMatch = nrMatches.some(nrId => item.rawSkuMatches && item.rawSkuMatches.includes(nrId) && nrId !== "");
                        if (isMatch) {
                            matchFound = true;
                            if (!item.isNoRebate) {
                                item.isNoRebate = true;
                                flaggedCount++;
                            }
                        }
                    });

                    if (!matchFound) {
                        failedMatchCount++;
                        if (failedMatchCount <= 20) console.warn(`No-Rebate SKU not found in Master DB: (Searched for: ${nrMatches.join(', ')})`);
                    }
                } else {
                    failedMatchCount++;
                }
            });

            localStorage.setItem('pricingDB', JSON.stringify(pricingDatabase));
            nrStatus.innerHTML = `Processed ${results.data.length} SKUs. <span style="color:green;">${flaggedCount} Locked</span> | <span style="color:red;">${failedMatchCount} Not Found</span>`;
            nrStatus.className = flaggedCount > 0 ? "status-badge status-success" : "status-badge status-error";
            console.log(`--- CROSS-REF COMPLETE. ${flaggedCount} Locked. ${failedMatchCount} Missed. ---`);
            renderDbPreview();
            executeSearch();
        }
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

function clearCart() {
    currentQuote = [];
    saveCart();
    renderUI();
}

function setTaxRate(value) {
    let num = parseFloat(value);
    if (isNaN(num) || num < 0) num = 0;
    if (num > 100) num = 100;
    taxRate = num;
    localStorage.setItem('taxRate', String(taxRate));
    renderUI();
}

function setIncludeTax(value) {
    includeTax = Boolean(value);
    localStorage.setItem('includeTax', String(includeTax));
    renderUI();
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

// --- Search & Quote Functions (rendering below) ---
function executeSearch() {
    const rawInput = document.getElementById('searchName').value.toLowerCase().trim();
    const dropdown = document.getElementById('searchDropdown');
    const activeCatalog = document.getElementById('fileFilter').value;
    dropdown.innerHTML = '';
    if (!rawInput || pricingDatabase.length === 0) {
        dropdown.innerHTML = '<option value="">-- Type above to search --</option>';
        currentSearchResults = [];
        return;
    }
    const searchTokens = rawInput.split(/\s+/);
    let targetDB = pricingDatabase;
    if (activeCatalog !== 'all') {
        targetDB = pricingDatabase.filter(item => item.sourceFile === activeCatalog);
    }
    currentSearchResults = targetDB.filter(item => {
        const squishedBlob = item.searchBlob.replace(/[^a-z0-9]/g, '');
        return searchTokens.every(token => {
            const squishedToken = token.replace(/[^a-z0-9]/g, '');
            return squishedToken === '' ? true : squishedBlob.includes(squishedToken);
        });
    }).slice(0, 100);
    if (currentSearchResults.length === 0) {
        dropdown.innerHTML = '<option value="">No matches found. Try adjusting your terms.</option>';
        return;
    }
    currentSearchResults.forEach((item, idx) => {
        const nrText = item.isNoRebate ? "[NO REBATE] " : "";
        const opt = document.createElement('option');
        opt.value = idx;
        console.log(`Search Result: ${item.name}`);
        opt.text = `${item.name}${nrText}`;
        dropdown.appendChild(opt);
    });
}

function addToQuote() {
    const dropdown = document.getElementById('searchDropdown');
    const selectedIdx = dropdown.value;
    if (selectedIdx === "" || currentSearchResults.length === 0) {
        return alert("Please select a valid item from the dropdown.");
    }
    const selectedItem = currentSearchResults[selectedIdx];
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
}

function updateQty(id, delta) {
    const item = currentQuote.find(i => i.cartId === id);
    if (item) {
        item.qty += delta;
        if (item.qty < 1) item.qty = 1;
        saveCart();
        renderUI();
    }
}

function setDiscount(id, value) {
    const item = currentQuote.find(i => i.cartId === id);
    if (item) {
        if (item.isNoRebate) return;
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

function renderUI() {
    renderBuilderTable();
    // Email table is rendered only when "Generate Quote" is clicked
}

function renderBuilderTable() {
    const tbody = document.getElementById('builderBody');
    tbody.innerHTML = '';
    if (currentQuote.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#999; padding: 20px;">Quote is empty. Search and add items above.</td></tr>';
        return;
    }
    currentQuote.forEach(item => {
        const baseUnitPrice = item.csvDiscPrice;
        const finalUnitPrice = item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (item.extraDiscPercent / 100));
        const lineTotal = finalUnitPrice * item.qty;
        const nrTag = item.isNoRebate ? '<span class="tag-nr">NR</span>' : '';
        const disableInput = item.isNoRebate ? 'disabled title="Discounts locked for this item"' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-size: 12px; font-weight: bold;">${item.name} ${nrTag}</td>
            <td style="color:#666;">${formatINR(item.erp)}</td>
            <td style="color:#666;">${formatINR(baseUnitPrice)}</td>
            <td>
                <div class="disc-control">
                    <input type="number" class="disc-input" value="${item.extraDiscPercent}" onchange="setDiscount(${item.cartId}, this.value)" ${disableInput}> %
                </div>
            </td>
            <td style="font-weight: bold; color: var(--brand-orange);">${formatINR(finalUnitPrice)}</td>
            <td>
                <div class="qty-control">
                    <button class="btn-small" onclick="updateQty(${item.cartId}, -1)">-</button>
                    <input type="number" class="qty-input" value="${item.qty}" readonly>
                    <button class="btn-small" onclick="updateQty(${item.cartId}, 1)">+</button>
                </div>
            </td>
            <td><strong>${formatINR(lineTotal)}</strong></td>
            <td><button class="btn-small btn-danger" onclick="removeItem(${item.cartId})">X</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEmailTable() {
    const outputArea = document.getElementById('emailOutputArea');
    if (currentQuote.length === 0) {
        outputArea.innerHTML = '<p style="color:#999;">The formatted email table will render here.</p>';
        return;
    }
    const showDiscColumn = currentQuote.some(item => item.extraDiscPercent > 0);
    let rowsHTML = '';
    let grandTotal = 0;
    currentQuote.forEach(item => {
        const baseUnitPrice = item.csvDiscPrice;
        const finalUnitPrice = item.isNoRebate ? baseUnitPrice : baseUnitPrice * (1 - (item.extraDiscPercent / 100));
        const lineTotal = finalUnitPrice * item.qty;
        grandTotal += lineTotal;
        //const nrTag = item.isNoRebate ? '<span style="color:#cc0000; font-size:10px; font-weight:bold; margin-left:4px;">[NR]</span>' : '';

        // Ensure product title leads the description in final email output
        let title = item.title;
        if (!title) {
            const match = pricingDatabase.find(p => p.name === item.name);
            if (match && match.title) title = match.title;
            else title = item.name;
        }
        const trailing = item.name ? item.name.replace(title, '').trim() : '';
        const displayDesc = title;

        let extraDiscCell = '';
        if (showDiscColumn) {
            const cellValue = (item.extraDiscPercent > 0 && !item.isNoRebate) ? formatINR(finalUnitPrice) : formatINR(baseUnitPrice);
            extraDiscCell = `<td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color: #F27222;">${cellValue}</td>`;
        }
        rowsHTML += `
            <tr>
                <td style="border: 1px solid #e6e6e6; padding: 10px; font-size: 13px;">${displayDesc}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right; color:#666;">${formatINR(item.erp)}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right;">${formatINR(baseUnitPrice)}</td>
                ${extraDiscCell}
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: center;">${item.qty}</td>
                <td style="border: 1px solid #e6e6e6; padding: 10px; text-align: right;"><strong>${formatINR(lineTotal)}</strong></td>
            </tr>
        `;
    });
    const colSpanTotal = showDiscColumn ? 5 : 4;
    const taxAmount = includeTax ? grandTotal * (taxRate / 100) : 0;
    const totalWithTax = grandTotal + taxAmount;
    const finalTotal = includeTax ? totalWithTax : grandTotal;

    const tableHTML = `
        <div style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc; padding: 15px 0; display:flex; justify-content:center;">
            <table class="email-quote-table" style="border-collapse: collapse; width: 100%; max-width: 650px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; text-align: left; color: #333;">Description</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; color: #333;">ERP Price</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; color: #333;">Unit Price</th>
                        ${showDiscColumn ? '<th style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; color: #333;">Discounted Price</th>' : ''}
                        <th style="border: 1px solid #e6e6e6; padding: 12px; text-align: center; color: #333;">Qty</th>
                        <th style="border: 1px solid #e6e6e6; padding: 12px; text-align: right; color: #333;">Ext. Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
                <tfoot>
                    ${includeTax ? `<tr class="email-subtotal-row">
                        <td colspan="${colSpanTotal}" class="email-sub-label"><strong>Subtotal:</strong></td>
                        <td class="email-sub-value"><strong>${formatINR(grandTotal)}</strong></td>
                    </tr>` : ''}
                    ${includeTax ? `<tr class="email-tax-row">
                        <td colspan="${colSpanTotal}" class="email-sub-label"><strong>Tax (${taxRate}%):</strong></td>
                        <td class="email-sub-value"><strong>${formatINR(taxAmount)}</strong></td>
                    </tr>` : ''}
                    <tr class="email-grand-row">
                        <td colspan="${colSpanTotal}" class="email-grand-label"><strong>${includeTax ? 'Grand Total:' : 'Total:'}</strong></td>
                        <td class="email-grand-value"><strong>${formatINR(finalTotal)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
    outputArea.innerHTML = tableHTML;
}


// simple toast for transient messages in bottom-right corner
function showToast(message, duration = 2000) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    // make visible
    toast.classList.add('show');
    // clear previous hide timer if any
    if (toast._hideTimeout) clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function copyTable() {
    const outputArea = document.getElementById('emailOutputArea');
    if (currentQuote.length === 0) {
        showToast("Quote is empty, nothing to copy.");
        return;
    }
    try {
        const range = document.createRange();
        range.selectNodeContents(outputArea);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const successful = document.execCommand('copy');
        selection.removeAllRanges();
        if (successful) {
            showToast("Table copied! Paste into your email.");
        } else {
            showToast("Copy was blocked, please copy manually.");
        }
    } catch (err) {
        console.error("Copy failed:", err);
        showToast("Error while copying to clipboard.");
    }
}
