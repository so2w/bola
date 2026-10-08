export class TicketSystem {
  public static calculateMatchRevenue(fans: number, stadiumCapacity: number, ticketPrice = 10): number {
    const validFans = Math.max(0, fans);
    const validCapacity = Math.max(0, stadiumCapacity);
    const attendance = Math.min(validFans, validCapacity);
    return attendance * Math.max(0, ticketPrice);
  }
}
