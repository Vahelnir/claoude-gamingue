import { MikroORM } from "@mikro-orm/core";
import { User } from "./entity/User";
import { VMCache } from "./entity/VMCache";

type ConfigurationType = Parameters<typeof MikroORM.init>[0];

// TODO: use ENV (but the cli also uses this config)
const config: ConfigurationType = {
  entities: [User, VMCache],
  dbName: "claoude-gamingue",
  type: "mariadb", // one of `mongo` | `mysql` | `mariadb` | `postgresql` | `sqlite`
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
};

export default config;
