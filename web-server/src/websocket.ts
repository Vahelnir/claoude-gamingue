import { Connection, EntityManager, IDatabaseDriver } from "@mikro-orm/core";
import { FastifyPluginAsync } from "fastify";
import Container from "typedi";
import { VMCache } from "./entity/VMCache";
import { provide_vm_manager, use_vm_manager } from "./vms/vm_manager";
import { Client } from "./websocket/client";

type ConnectedUser = { last_message_time: number; client: Client | null };
const connected_users = new Map<string, ConnectedUser>();

export const websocket_plugin: FastifyPluginAsync = async function (fastify) {
  const entity_manager =
    Container.get<EntityManager<IDatabaseDriver<Connection>>>(
      EntityManager
    ).fork();

  clear_existing_cache(entity_manager);
  start_loop(entity_manager);

  fastify.get("/ws", { websocket: true }, async (connection, request) => {
    connection.on("error", (err) => console.log(err));
    console.log("client connecting...");
    const logged_user = request.logged_user;
    if (!logged_user) {
      connection.socket.send(
        JSON.stringify({ type: "error", data: { error: "not logged" } })
      );
      connection.socket.close();
      console.log("client not logged");
      return;
    }

    if (!logged_user.subscribed) {
      connection.socket.send(
        JSON.stringify({ type: "error", data: { error: "not subscribed" } })
      );
      connection.socket.close();
      console.log("client not subscribed");
      return;
    }

    const previously_connected_user = connected_users.get(logged_user.id);
    if (previously_connected_user?.client) {
      console.log("client already connected");
      connection.socket.send(
        JSON.stringify({
          name: "error",
          data: {
            type: "already_connected",
            error: "user already connected on another tab or browser",
          },
        })
      );
      connection.socket.close();
      return;
    }

    console.log("client connected!");
    const client = new Client(connection.socket, request, logged_user);

    const connected_user: ConnectedUser = {
      last_message_time: Date.now(),
      client,
    };
    connected_users.set(logged_user.id, connected_user);
    connection.socket.on("message", () => {
      connected_user.last_message_time = Date.now();
    });
    connection.socket.on("close", () => {
      console.log("closing..");
      connected_user.client?.destroy();
      connected_user.client = null;
    });
  });
};

function start_loop(entity_manager: EntityManager) {
  setInterval(async () => {
    // No await because we do not want to block the save
    delete_unused_vms();

    await save_vm_cache(entity_manager);
  }, 60_000);
}

function delete_unused_vms() {
  console.log("cleaning unused vms");
  const vm_manager = use_vm_manager();
  const now = Date.now();

  const vm_remove_promises = Array.from(vm_manager.cache.entries())
    .filter(([user_id]) => {
      const connected_user = connected_users.get(user_id);
      return (
        !connected_user || now - connected_user.last_message_time >= 60_000
      );
    })
    .map(([user_id, vm_cache]) =>
      vm_manager.delete(user_id, vm_cache.resource_id)
    );

  console.log(`clearing ${vm_remove_promises.length} unused vms`);

  return Promise.all(vm_remove_promises);
}

async function save_vm_cache(entity_manager: EntityManager) {
  console.log("saving vm cache in database");
  const vm_manager = use_vm_manager();
  // clear every existing entry
  await entity_manager.nativeDelete(VMCache, {});
  // recreate every entry currently in memory
  for (const [user_id, cached_vm] of vm_manager.cache.entries()) {
    const vm_cache = new VMCache(user_id, cached_vm.resource_id);
    entity_manager.persist(vm_cache);
  }
  await entity_manager.flush();
}

async function clear_existing_cache(entity_manager: EntityManager) {
  const caches = await entity_manager.find(VMCache, {});

  const ids = caches.map((cache) => cache.resource_id);
  const vm_manager = provide_vm_manager({
    cache: new Map(),
    ids: new Set(ids),
  });

  const vm_remove_promises = caches.map(({ user_id, resource_id }) => {
    return vm_manager.delete(user_id, resource_id);
  });

  await Promise.all(vm_remove_promises);
}
