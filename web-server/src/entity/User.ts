import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { v4 } from "uuid";

@Entity()
export class User {
  @PrimaryKey()
  id: string = v4();

  @Property()
  email!: string;

  @Property()
  password!: string;

  @Property()
  subscribed: boolean = false;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  editedAt: Date = new Date();
}
