export type Role = 'reader' | 'staff' | 'admin';
export interface User { id: number; email: string; role: Role; active?: boolean }
export interface Named { id: number; name: string }
export interface Book { id: number; title: string; description: string; isbn: string | null; authors: Named[]; genres: Named[] }
export interface Copy { id: number; book_id: number; barcode: string; active: boolean; available: boolean }
export type BookingStatus = 'reserved' | 'loaned' | 'returned' | 'cancelled' | 'expired';
export interface Booking { id: number; copy_id: number; user_id: number; email: string; starts_at: string; ends_at: string; status: BookingStatus; book_id?: number; book_title?: string; barcode?: string }
export interface Recommendation { book: Book; score: number }
export interface Personal { basis: 'reading_history' | 'interests' | 'neural_discovery'; items: Recommendation[] }
export interface IndexStatus { indexed: number; ready: boolean; model: string }
