import "dotenv/config";
import { create_resources, delete_resources } from "./create-vm";

async function run() {
  // create_resources("001", "monid");
  delete_resources("001");
}

run().catch((err) => console.error(err));
