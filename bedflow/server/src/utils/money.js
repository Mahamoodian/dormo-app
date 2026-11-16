export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const balanceOf = (r) => round2(Number(r.amount_due) - Number(r.amount_paid) - Number(r.amount_written_off));
