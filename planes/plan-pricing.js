export function planSavings(plan,express){
 if(!plan.months||!Number.isInteger(plan.auditsPerMonth)||!express||!Number.isSafeInteger(express.priceMinor))return null;
 const reference=express.priceMinor*plan.auditsPerMonth,saving=reference-plan.priceMinor;
 if(!Number.isSafeInteger(saving)||saving<=0)return null;
 return {reference,saving,total:saving*plan.months,percent:Math.round(saving/reference*100)};
}
