import {
  create_resources,
  delete_resources,
  delete_resources_and_wait,
  CreatedVM,
} from "claoude-vm";
import EventEmitter from "events";

// TODO: probably changing in the future
export type CachedVM =
  | {
      status: "creating";
      resource_id: string;
    }
  | {
      status: "created";
      resource_id: string;
      created_vm: CreatedVM;
    }
  | {
      status: "removing";
      resource_id: string;
      created_vm: CreatedVM;
    };
type CachedVMStatus = CachedVM["status"];

const MAX_TRY = 5;

type VMManagerEvents = {
  vm_ready: ({
    created_vm,
    user_id,
  }: {
    created_vm: CachedVM;
    user_id: string;
  }) => void;

  vm_error: ({ user_id }: { user_id: string }) => void;
};

export interface VMManager {
  on<U extends keyof VMManagerEvents>(
    event: U,
    listener: VMManagerEvents[U]
  ): this;

  off<U extends keyof VMManagerEvents>(
    event: U,
    listener: VMManagerEvents[U]
  ): this;

  emit<U extends keyof VMManagerEvents>(
    event: U,
    ...args: Parameters<VMManagerEvents[U]>
  ): boolean;
}

export class VMManager extends EventEmitter {
  constructor(
    private vm_cache = new Map<string, CachedVM>(),
    private used_vm_ids = new Set<string>()
  ) {
    super();
    // TODO: load internal vm cache from DB
  }

  get cache() {
    return this.vm_cache;
  }

  async get_or_start_vm(user_id: string): Promise<CachedVM | undefined> {
    let created_vm = this.vm_cache.get(user_id);
    if (!created_vm) {
      created_vm = await this.start_vm(user_id);
    }

    if (created_vm) {
      this.emit("vm_ready", { created_vm, user_id });
    } else {
      this.emit("vm_error", { user_id });
    }

    return created_vm;
  }

  async delete(user_id: string, resource_id: string) {
    this.vm_cache.delete(user_id);
    await delete_resources_and_wait(resource_id);
    this.used_vm_ids.delete(resource_id);
  }

  private async start_vm(user_id: string): Promise<CachedVM | undefined> {
    let id;
    let try_count = 0;
    do {
      id = this.generate_vm_id().toString();
      try_count += 1;
    } while (this.used_vm_ids.has(id) && try_count < MAX_TRY);

    if (try_count > MAX_TRY) {
      return;
    }

    let cached_vm: CachedVM = { status: "creating", resource_id: id };
    this.vm_cache.set(user_id, cached_vm);
    this.used_vm_ids.add(id);

    const vm_info = await create_resources(id, user_id);
    if (!vm_info) {
      await delete_resources(id);
      this.vm_cache.delete(user_id);
      this.used_vm_ids.delete(id);
      return;
    }

    cached_vm = { status: "created", resource_id: id, created_vm: vm_info };
    this.vm_cache.set(user_id, cached_vm);
    return cached_vm;
  }

  private generate_vm_id() {
    return Math.round(Math.random() * 999);
  }
}

let vm_manager_instance: VMManager;

export function provide_vm_manager({
  cache,
  ids,
}: {
  cache: Map<string, CachedVM>;
  ids: Set<string>;
}) {
  vm_manager_instance = new VMManager(cache, ids);
  return vm_manager_instance;
}

export function use_vm_manager() {
  if (!vm_manager_instance) {
    throw new Error("vm manager not created yet");
  }

  return vm_manager_instance;
}
