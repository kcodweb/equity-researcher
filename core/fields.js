// One normalized financial model, mapped to Yahoo timeseries types and
// SEC us-gaap XBRL tags (in priority order).
// kind: 'flow' = period amount (income / cash flow), 'stock' = balance at period end.
// sign: -1 flips sources that report outflows as negatives, so capex,
// dividends, buybacks and acquisitions are always positive amounts spent.

export const FIELDS = {
  // Income statement
  revenue: { kind: 'flow', label: 'Revenue', yahoo: ['TotalRevenue'], sec: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet'] },
  costOfRevenue: { kind: 'flow', label: 'Cost of revenue', yahoo: ['CostOfRevenue'], sec: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'] },
  grossProfit: { kind: 'flow', label: 'Gross profit', yahoo: ['GrossProfit'], sec: ['GrossProfit'] },
  sga: { kind: 'flow', label: 'SG&A', yahoo: ['SellingGeneralAndAdministration'], sec: ['SellingGeneralAndAdministrativeExpense'] },
  rnd: { kind: 'flow', label: 'R&D', yahoo: ['ResearchAndDevelopment'], sec: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'] },
  depreciation: { kind: 'flow', label: 'Depreciation & amortization', yahoo: ['ReconciledDepreciation', 'DepreciationAndAmortization'], sec: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'] },
  operatingIncome: { kind: 'flow', label: 'Operating income (EBIT)', yahoo: ['OperatingIncome', 'EBIT'], sec: ['OperatingIncomeLoss'] },
  ebitda: { kind: 'flow', label: 'EBITDA', yahoo: ['EBITDA', 'NormalizedEBITDA'], sec: [] },
  interestExpense: { kind: 'flow', label: 'Interest expense', yahoo: ['InterestExpense'], sec: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'] },
  netInterestIncome: { kind: 'flow', label: 'Net interest income', yahoo: ['NetInterestIncome'], sec: ['InterestIncomeExpenseNet'] },
  pretaxIncome: { kind: 'flow', label: 'Pre-tax income', yahoo: ['PretaxIncome'], sec: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'] },
  incomeTax: { kind: 'flow', label: 'Income tax', yahoo: ['TaxProvision'], sec: ['IncomeTaxExpenseBenefit'] },
  netIncome: { kind: 'flow', label: 'Net income', yahoo: ['NetIncomeCommonStockholders', 'NetIncome'], sec: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'] },
  epsDiluted: { kind: 'flow', label: 'EPS (diluted)', unit: 'USD/shares', yahoo: ['DilutedEPS'], sec: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'] },
  sharesDiluted: { kind: 'flow', label: 'Diluted shares', unit: 'shares', yahoo: ['DilutedAverageShares'], sec: ['WeightedAverageNumberOfDilutedSharesOutstanding'] },

  // Balance sheet
  cash: { kind: 'stock', label: 'Cash & equivalents', yahoo: ['CashAndCashEquivalents'], sec: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'] },
  shortTermInvestments: { kind: 'stock', label: 'Short-term investments', yahoo: ['OtherShortTermInvestments'], sec: ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'] },
  receivables: { kind: 'stock', label: 'Receivables', yahoo: ['AccountsReceivable', 'Receivables'], sec: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'] },
  inventory: { kind: 'stock', label: 'Inventory', yahoo: ['Inventory'], sec: ['InventoryNet'] },
  currentAssets: { kind: 'stock', label: 'Current assets', yahoo: ['CurrentAssets'], sec: ['AssetsCurrent'] },
  ppe: { kind: 'stock', label: 'Net PP&E', yahoo: ['NetPPE'], sec: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'] },
  goodwill: { kind: 'stock', label: 'Goodwill', yahoo: ['Goodwill'], sec: ['Goodwill'] },
  intangibles: { kind: 'stock', label: 'Other intangibles', yahoo: ['OtherIntangibleAssets'], sec: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'] },
  totalAssets: { kind: 'stock', label: 'Total assets', yahoo: ['TotalAssets'], sec: ['Assets'] },
  accountsPayable: { kind: 'stock', label: 'Accounts payable', yahoo: ['AccountsPayable'], sec: ['AccountsPayableCurrent'] },
  currentLiabilities: { kind: 'stock', label: 'Current liabilities', yahoo: ['CurrentLiabilities'], sec: ['LiabilitiesCurrent'] },
  shortTermDebt: { kind: 'stock', label: 'Short-term debt', yahoo: ['CurrentDebt'], sec: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings'] },
  longTermDebt: { kind: 'stock', label: 'Long-term debt', yahoo: ['LongTermDebt'], sec: ['LongTermDebtNoncurrent', 'LongTermDebt'] },
  totalDebt: { kind: 'stock', label: 'Total debt', yahoo: ['TotalDebt'], sec: [] },
  totalLiabilities: { kind: 'stock', label: 'Total liabilities', yahoo: ['TotalLiabilitiesNetMinorityInterest'], sec: ['Liabilities'] },
  equity: { kind: 'stock', label: "Shareholders' equity", yahoo: ['StockholdersEquity'], sec: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  retainedEarnings: { kind: 'stock', label: 'Retained earnings', yahoo: ['RetainedEarnings'], sec: ['RetainedEarningsAccumulatedDeficit'] },
  sharesOutstanding: { kind: 'stock', label: 'Shares outstanding', unit: 'shares', yahoo: ['OrdinarySharesNumber', 'ShareIssued'], sec: ['CommonStockSharesOutstanding'] },

  // Cash flow
  cfo: { kind: 'flow', label: 'Operating cash flow', yahoo: ['OperatingCashFlow'], sec: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  capex: { kind: 'flow', label: 'Capital expenditure', yahoo: ['CapitalExpenditure'], yahooSign: -1, sec: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'] },
  acquisitions: { kind: 'flow', label: 'Acquisitions', yahoo: ['PurchaseOfBusiness'], yahooSign: -1, sec: ['PaymentsToAcquireBusinessesNetOfCashAcquired'] },
  dividendsPaid: { kind: 'flow', label: 'Dividends paid', yahoo: ['CashDividendsPaid', 'CommonStockDividendPaid'], yahooSign: -1, sec: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'] },
  buybacks: { kind: 'flow', label: 'Share buybacks', yahoo: ['RepurchaseOfCapitalStock', 'CommonStockPayments'], yahooSign: -1, sec: ['PaymentsForRepurchaseOfCommonStock'] },
  sbc: { kind: 'flow', label: 'Stock-based compensation', yahoo: ['StockBasedCompensation'], sec: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'] },
};

export const FIELD_KEYS = Object.keys(FIELDS);

// Statement layouts used by the Financials tab. Derived rows are computed in normalize.
export const STATEMENTS = {
  income: ['revenue', 'costOfRevenue', 'grossProfit', 'sga', 'rnd', 'ebitda', 'depreciation', 'operatingIncome', 'netInterestIncome', 'interestExpense', 'pretaxIncome', 'incomeTax', 'netIncome', 'epsDiluted', 'sharesDiluted'],
  balance: ['cash', 'shortTermInvestments', 'receivables', 'inventory', 'currentAssets', 'ppe', 'goodwill', 'intangibles', 'totalAssets', 'accountsPayable', 'currentLiabilities', 'shortTermDebt', 'longTermDebt', 'totalDebt', 'totalLiabilities', 'equity', 'retainedEarnings', 'sharesOutstanding'],
  cashflow: ['cfo', 'capex', 'fcf', 'acquisitions', 'dividendsPaid', 'buybacks', 'sbc'],
};

export const DERIVED_LABELS = { fcf: 'Free cash flow' };
