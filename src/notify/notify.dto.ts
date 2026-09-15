import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class SendNotificationDto {
  @IsNotEmpty()
  @IsIn(['USER', 'SOBE', 'HAMISI'])
  hedefTipi: 'USER' | 'SOBE' | 'HAMISI';

  @IsOptional()
  @IsString()
  hedefId?: string;

  @IsNotEmpty()
  @IsString()
  mesaj: string;

  @IsOptional()
  @IsIn(['ADI', 'VACIB', 'COX_VACIB'])
  seviyye?: 'ADI' | 'VACIB' | 'COX_VACIB';
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
  @IsNotEmpty()
  sobeIds: string[]; // Şöbə ID-lərinin massivi
}
