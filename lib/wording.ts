// Customer-facing sentences that match what was actually ordered ("Your 2 Masala Dosas and Filter Coffee are…").
import type { Order } from './orders';

type Lines = Pick<Order['lines'][number], 'name' | 'qty'>[];

const plural = (name: string) => (/s$/i.test(name) ? name : `${name}s`);

// "Masala Dosa", "2 Masala Dosas and Masala Tea", "Masala Dosa, Medu Vada and 2 more"
export function itemsPhrase(lines: Lines): string {
  const parts = lines.map((l) => (l.qty > 1 ? `${l.qty} ${plural(l.name)}` : l.name));
  if (parts.length > 3) return `${parts.slice(0, 2).join(', ')} and ${parts.length - 2} more`;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The line under "Thank you" on the kiosk's order-number screen.
export function orderedSentence(o: Pick<Order, 'status' | 'payMethod' | 'type' | 'total'> & { lines: Lines }): string {
  const items = itemsPhrase(o.lines);
  const many = o.lines.reduce((a, l) => a + l.qty, 0) > 1;
  const isAre = many ? 'are' : 'is';
  const where = o.type === 'dine_in' ? 'Grab a seat, we’ll call you.' : 'We’ll pack it to take away.';
  switch (o.status) {
    case 'awaiting_cash':
      return o.payMethod === 'upi'
        ? `We’ll start your ${items} as soon as the counter confirms your payment.`
        : `Pay ₹${o.total} at the counter and we’ll start your ${items}.`;
    case 'ready':
      return `Your ${items} ${isAre} ready! Collect from the counter.`;
    case 'handed_over':
      return `Enjoy your ${items}!`;
    case 'cancelled':
      return 'This order was cancelled.';
    default:
      return `Your ${items} ${isAre} being made fresh. ${where}`;
  }
}
