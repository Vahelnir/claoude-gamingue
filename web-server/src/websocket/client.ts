import { EntityManager } from "@mikro-orm/core";
import { FastifyRequest } from "fastify";
import WebSocket from "ws";

import { User } from "../entity/User";
import { CachedVM, use_vm_manager, VMManager } from "../vms/vm_manager";
import { games } from "../games";

type Message = {
  type: string;
  data: unknown;
};

type GameStartMessage = {
  type: "game:start";
  data: { id: number };
};

type GamePingMessage = {
  type: "game:ping";
  data: {};
};

type Messages = GameStartMessage | GamePingMessage;

export class Client {
  private vm_manager: VMManager;

  private vm_manager_events: {
    event: string;
    handler: (...args: any[]) => void;
  }[] = [];

  constructor(
    private socket: WebSocket,
    private request: FastifyRequest,
    private user: User
  ) {
    this.vm_manager = use_vm_manager();
    this.register_events();
  }

  private register_events() {
    this.socket.on("message", (raw_buffer) => {
      const raw_message = raw_buffer.toString("utf8");
      const message = this.parse_message(raw_message);
      if (!message) {
        this.send("error", {
          error: "malformed message, unparsable",
        });
        return;
      }

      this.handle_message(message as Messages);
    });

    const vm_error_handler = ({ user_id }: { user_id: string }) => {
      this.vm_manager.off("vm_ready", vm_error_handler);
      this.send_error("game:error", {
        error: "an error occured while starting the VM, please try again later",
      });
    };
    this.vm_manager.on("vm_error", vm_error_handler);
    this.vm_manager_events.push({
      event: "vm_error",
      handler: vm_error_handler,
    });
  }

  async handle_message(message: Messages) {
    if (message.type === "game:start") {
      this.send("game:starting", {});

      const vm_ready_handler = ({
        created_vm: created_vm,
      }: {
        created_vm: CachedVM;
      }) => {
        this.vm_manager.off("vm_ready", vm_ready_handler);
        if (!created_vm) {
          this.send("game:error", {
            error: "could not create a new VM, please try again later",
          });
          return;
        }

        if (created_vm.status !== "created") {
          return;
        }

        const game = games.find((game) => game.id === message.data.id);
        if (!game) {
          this.send_error("game:error", { error: "game does not exist" });
          return;
        }

        const ip =
          created_vm.created_vm.public_ip.ipAddress ??
          created_vm.created_vm.public_ip.dnsSettings?.fqdn;

        this.send("game:started", {
          url: `http://${ip}/${game.internal_path}/index.html`,
        });
      };

      this.vm_manager_events.push({
        event: "vm_ready",
        handler: vm_ready_handler,
      });
      this.vm_manager.once("vm_ready", vm_ready_handler);

      this.vm_manager.get_or_start_vm(this.user.id);
    }
  }

  send(name: string, data: unknown) {
    this.socket.send(
      JSON.stringify({
        name,
        data,
      })
    );
  }

  send_error(type: string, data: { error: string }) {
    this.socket.send(
      JSON.stringify({
        name: "error",
        data: { ...data, type },
      })
    );
  }

  destroy() {
    for (const { event, handler } of this.vm_manager_events) {
      this.vm_manager.off(event as any, handler);
    }
  }

  private parse_message(raw_message: string): Message | null {
    try {
      return JSON.parse(raw_message);
    } catch (error) {
      return null;
    }
  }
}
