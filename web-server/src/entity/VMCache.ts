import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class VMCache {
  @PrimaryKey()
  @Property()
  user_id!: string;

  @Property({ unique: true })
  resource_id!: string;

  constructor(user_id: string, resource_id: string) {
    this.user_id = user_id;
    this.resource_id = resource_id;
  }
}
