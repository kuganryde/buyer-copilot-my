# Using the Hub

[← Back to README](../README.md)

The Buyer Command Hub is one page in English or Bahasa Melayu, switched with **EN / BM** at the top right. It has four sections:

| Section | What the buyer does there |
|---|---|
| **Your Approvals** | Sees which of the 5 steps they're on and what they're deciding. Reviews key cash figures and risks, then approves, requests changes or stops the purchase. **Must fix** risks block approval. Each **warning** must be ticked before approving, and the page says why Approve is disabled. Stopping a purchase needs an in-page confirmation. **Decision history** shows every decision with a check code, and a **Record intact** badge shows nothing was altered. |
| **Cash and Stamp Duty** | Enters price, valuation and loan, then gets cash at signing, total cash needed and transfer stamp duty. Each cost shows when it's paid and whether it's **Set by law**, an **Estimate** or a **Proposal**. The Budget 2027 proposal appears only in a separate "Not law yet" box. |
| **Documents** | Ticks off the documents for each step. Adding a file creates a fingerprint in the browser (files aren't uploaded). Pasting an official title search pulls out key facts, such as owner, tenure, lease end and bank charge, for the buyer to check. |
| **Official Sources** | Government agencies and rules, filtered by topic and state. Each entry shows when someone last checked it. |

The five steps the buyer approves:

1. **Check the listing:** facts, risks and upfront cash, before ordering an official title search.
2. **Set offer and budget:** search, site and valuation results, then offer price, loan and cash buffer.
3. **Lawyer and deposit:** choose a lawyer; the deposit is held by the lawyer as stakeholder, with a written receipt.
4. **Sign and pay duty:** go through the sale agreement (SPA), loan, State consent and stamp duty with the lawyer.
5. **Transfer and keys:** confirm registration (Borang 14A), handover checklist and bill split, then close.

All copy lives in [`web/lib/copilot.ts`](../web/lib/copilot.ts). Before changing any wording, read [`web/CONTENT_GUIDE.md`](../web/CONTENT_GUIDE.md).
