import { IsNotEmpty, IsOptional, IsString, IsIn, IsArray } from 'class-validator';

export class SendNotificationDto {
  @IsNotEmpty()
  @IsIn(['USER', 'SOBE', 'HAMISI', 'user', 'sobe', 'hamisi', 'ISTIFADECI', 'istifadeci'])
  hedefTipi: string;

  @IsOptional()
  @IsString()
  hedefId?: string;

  @IsNotEmpty()
  @IsString()
  mesaj: string;

  @IsOptional()
  @IsIn(['ADI', 'VACIB', 'COX_VACIB', 'adi', 'vacib', 'cox_vacib'])
  seviyye?: string;
}

export class DeleteNotificationDto {
  @IsNotEmpty()
  @IsString()
  bildirisId: string;
}

export class MarkDeliveredDto {
  @IsNotEmpty()
  @IsString()
  bildirisId: string;
}

export class MarkReadDto {
  @IsNotEmpty()
  @IsString()
  bildirisId: string;
}

export class CreateSobeDto {
  @IsNotEmpty()
  @IsString()
  ad: string;
}

export class AssignUserSobeDto {
  @IsArray()
  @IsString({ each: true })
  sobeIds: string[]; // Şöbə ID-lərinin massivi
}
