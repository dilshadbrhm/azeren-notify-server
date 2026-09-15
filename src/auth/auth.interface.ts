export interface PmsUserResponse {
  id: string | number;
  name?: string;
  adSoyad?: string;
  [key: string]: any;
}

export interface CurrentUser {
  id: string;
  adSoyad: string;
  rol: 'SUPERADMIN' | 'ADMIN' | 'USER';
  sonGirisTarixi?: Date | null;
  cihazId?: string | null;
}
