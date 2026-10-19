# QuoteGenerator

Create email-ready quotes from CSV and Excel price lists. Import catalogs,
search products, adjust quantities and discounts, and copy a formatted quote
into your email.

**Live app:** [https://vivekgondil.github.io/QuoteGenerator/](https://vivekgondil.github.io/QuoteGenerator/)

## Quick start

1. Open the live app and select **Price List Manager**.
2. Choose one or more price-list files and click **Load Catalog**.
3. Close the manager, choose an **Active Catalog**, and search for a product.
4. Click a search result to add it to the quote.
5. Enter a **Quote Name**, adjust quantities and discounts, and review **Settings**.
6. Click **Generate Quote**, then **Copy to Clipboard**.
7. Paste into an Outlook or Gmail message using normal paste to retain the table formatting.

## 1. Import price lists

Open **Price List Manager**, select CSV, XLSX, or XLS files under
**Upload Master Rate Cards**, then click **Load Catalog**.

### File format

Use the first row as column headers. Each product row needs a recognized name
column and a price column. Common supported headers include:

| Data | Supported headers |
| --- | --- |
| Product name | `SkuTitle`, `ProductTitle`, `ProductName`, `Description` |
| List price | `ERP`, `ERPPrice`, `ListPrice` |
| Selling price | `UnitSellPrice`, `UnitSell`, `Price` |
| Discounted price / cost | `DiscountedPrice`, `DiscountPrice`, `Cost` |
| Optional identifiers | `SkuId`, `SKU`, `ProductId`, `ItemNumber`, `PartNumber`, `PartNo`, `MPN` |

Header matching ignores case, spaces, and punctuation. For example, `Part No`
and `PartNo` are both recognized.

Example CSV:

```csv
SkuTitle,PartNumber,ERP,DiscountedPrice
Example Product A,PART-001,1000,900
Example Product B,PART-002,2000,1800
```

When a discounted price/cost column is populated, it becomes the quote's base
cost. Otherwise, the importer falls back to a recognized list or selling price.
Prices are displayed in Indian rupees (INR).

### Multiple sheets and catalog refreshes

- Every worksheet in an Excel workbook is processed separately.
- Sheets with recognized product and price rows appear in **Active Catalog**
  as `filename - sheet name`. CSV catalogs keep their filename.
- Empty sheets and sheets without recognized product/price columns do not
  create catalog entries.
- Duplicate display names are skipped within each sheet, not across sheets.
- The upload status reports loaded rows, replaced rows, skipped duplicates,
  and failures. **Data Preview** displays the first 100 catalog rows overall.

Re-importing the same filename replaces all its previously imported sheets
(including sheets removed from the workbook) and preserves matching No-Rebate
locks. Previously imported Excel files must be imported again to load all sheets.

## 2. Find products and build a quote

1. Choose a sheet or file in **Active Catalog** to browse up to 50 products
   without typing, or select **Search All Catalogs** and enter a search term.
2. Search by product description, SKU, part number, or other imported details.
3. Click a result to add it to the quote.
4. Change **Qty** and **Extra Disc** for each line as needed. Discounts range
   from 0% to 100%; the increase/decrease controls move in 0.25 percentage-point
   steps, including the default and per-year discounts. **Final Sell** and
   **Ext Total** update automatically.
5. Use a line's remove button to delete it, or **Clear Quote** to empty the
   current quote.

Use **New Quote** to start a separate quote with a new name and identity.
This clears the current quote's items. Automatic names use the highest saved
`Quote N` number plus one: a saved `Quote 2` makes the next draft `Quote 3`.
If there are no saved numbered quotes, the draft is named `Quote 1`.
Starting unsaved drafts does not advance the number; custom names and names
such as `Quote 2 (Copy)` do not count toward numbering.
Click **Save Quote** or **Generate Quote** first if you want the current quote
retained in **Saved Quotes**.

## 3. Configure pricing and quote details

Open the sidebar's **Settings** tab:

Use **Price List Manager** under **Price Lists** to open the catalog import
and management dialog. The header's Price List Manager button is also available.

| Setting | How to use it |
| --- | --- |
| Default Margin Discount (%) | Sets the starting extra discount for newly added products; existing lines are unchanged. |
| Tax Rate (%) | Sets the tax percentage; the initial default is 18%. |
| Include Tax in Final Quote | Controls whether tax is included in the generated totals. When unchecked, the quote's terms state "Taxes extra." |
| Enable "Split into 3 years" discount feature | Shows the three-year discount option on eligible quote lines. |
| Price Validity | Sets the validity date shown in the quote; initially defaults to the current month's last day. |
| Additional Conditions | Adds payment terms, freight notes, or other conditions to the generated quote. |

For eligible products, click **Split into 3 years** on the quote line to enter
separate discounts for Years 1, 2, and 3. The base cost is divided across the
three years before each year's discount is applied; it is not charged in full
three times. Click **Use single discount** to return to a single discount.

## 4. Apply No-Rebate rules (optional)

1. Import your master price list first.
2. In **Price List Manager**, choose a CSV or Excel file under
   **Apply No-Rebate Rules**.
3. Include identifier columns such as `SkuId`, `ProductId`, or `PartNumber`
   matching the price list, then click **Lock SKUs**.
4. Review the locked and unmatched counts. Matching products are marked
   **NO REBATE**, and newly added quote lines cannot receive extra discounts.

When both Product ID and SKU ID exist, they are matched together to avoid
confusing products that reuse the same SKU ID. Part numbers can also match.
For an Excel No-Rebate file, only the first worksheet is scanned.

Apply these rules before adding products to a quote: locking catalog products
does not retroactively change lines already in the current quote or saved quotes.

**Warning:** **Wipe No-Rebate SKUs** removes the matching products from the
catalog; it does not simply unlock their discounts. **Wipe Catalog** removes
the entire imported catalog and clears the current quote. Both require confirmation.

## 5. Generate and share a quote

1. Give the quote a meaningful **Quote Name**.
2. Review quantities, discounts, tax, validity, and conditions.
3. Click **Generate Quote** to save the quote and open the **Email-Ready Quote**
   preview.
4. Click **Copy to Clipboard** and paste into your email editor.

The output includes product descriptions, unit prices, quantities, line totals,
and applicable discounts, tax, validity, and additional conditions.
To save without opening the email preview, click **Save Quote** below the cart.
The quote stays in the editor and appears in **Saved Quotes**, with a save
confirmation. Saving or generating an already saved quote updates that entry
rather than creating a duplicate. Empty quotes cannot be saved.

## 6. Manage and back up saved quotes

In the **Saved Quotes** sidebar tab:

- Search for a saved quote and click it to load it into the editor.
- Duplicate a quote to create a separate copy.
- Delete individual quotes, or select checkboxes and use **Delete Selected**.
- Click **Export** to download saved quotes as JSON. If any quotes are
  selected, only those are exported; otherwise, all saved quotes are exported.
- Click **Import** and choose a previously exported JSON file to add its
  quotes to the current saved list. Imports create new entries rather than
  replacing existing ones.

Saved quote exports do not back up the full price catalog or global settings.
Keep your original price-list files so you can import them again.

## Browser storage and troubleshooting

### Using a phone

The quote cart uses labeled product cards on small screens, with larger inputs
and touch buttons. Scroll down below the cart actions for **Saved Quotes** and
**Settings**. Price-list previews and generated email tables scroll horizontally
inside their panels; the copied email keeps its table layout.

- Catalogs, the current quote, saved quotes, and most quote settings are stored
  in your browser's local storage. They do not automatically sync to another
  browser, device, or site address.
- Clearing site data or ending a private-browsing session can remove stored
  work. Export important saved quotes regularly.
- Price-list parsing runs in the browser. Internet access is needed to load
  the hosted app and its external parsing libraries.
- **Missing sheets or products:** re-import the workbook, check each sheet's
  header row and supported columns, and review the upload failure count.
- **No search results:** check the selected catalog or switch to
  **Search All Catalogs**. Global search requires a search term.
- **No-Rebate matches fail:** check that identifiers match the master price
  list and that the identifiers are on the first sheet of an Excel rules file.
- **Missing parser error:** check your internet connection and reload the app.
- **Email formatting is lost:** use normal paste rather than paste-as-plain-text
  in an email editor that supports HTML.