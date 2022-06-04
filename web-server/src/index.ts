import "reflect-metadata";
import "dotenv/config";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import PointOfView from "point-of-view";
import nunjucks from "nunjucks";
import { EntityManager, MikroORM } from "@mikro-orm/core";
import fastifySession from "@fastify/secure-session";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyFormbody from "@fastify/formbody";
import fastifyWebsocket from "@fastify/websocket";
import { hash, verify } from "argon2";
import { Container } from "typedi";

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";

import config from "./mikro-orm.config";
import { User } from "./entity/User";
import { websocket_plugin } from "./websocket";
import { games as all_games, games } from "./games";

// Run the server!
async function initialize_web_server() {
  const orm = await MikroORM.init(config);
  if (!(await orm.isConnected())) {
    await orm.connect();
  }

  Container.set(EntityManager, orm.em);

  const fastify = Fastify({
    logger: false,
  });

  fastify.register(fastifyWebsocket);
  fastify.register(fastifyFormbody);
  fastify.register(fastifyMultipart);

  fastify.register(PointOfView, {
    engine: {
      nunjucks,
    },
    templates: "templates/",
  });

  fastify.register(fastifyStatic, {
    root: resolve(__dirname, "../public"),
  });

  fastify.register(fastifySession, {
    cookieName: "session",
    key: readFileSync(join(dirname(__dirname), "secret-key")),
    cookie: {
      path: "/",
    },
  });

  fastify.decorateRequest("entity_manager", null);
  fastify.addHook("onRequest", async (request, reply) => {
    request.entity_manager = orm.em.fork();
  });

  fastify.decorateRequest("logged_user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const logged_user_id = request.session.get("user_id");
    const logged_user = await request.entity_manager.findOne(User, {
      id: logged_user_id,
    });
    request.logged_user = logged_user;
  });

  fastify.register(websocket_plugin);

  async function require_connected(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    // if not logged in, redirect to /login
    if (!request.logged_user) {
      return reply.redirect("/login");
    }
  }

  async function require_disconnected(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    // if not logged in, redirect to /login
    if (request.logged_user) {
      return reply.redirect("/home");
    }
  }
  // Declare a route
  fastify.get("/", async function (request, reply) {
    return reply.redirect("/home");
  });

  fastify.get("/home", async function (request, reply) {
    await require_connected(request, reply);
    const logged_user = request.logged_user;
    const is_subscribed = logged_user?.subscribed ?? false;
    const games = is_subscribed ? all_games : [];
    return reply.view("views/home.njk", { games });
  });

  fastify.get<{ Params: { id: string } }>(
    "/game/:id",
    async function (request, reply) {
      await require_connected(request, reply);
      const logged_user = request.logged_user;
      const is_subscribed = logged_user?.subscribed ?? false;
      if (!is_subscribed) {
        reply.redirect("/home");
        return;
      }

      const game = games.find((game) => game.id === +request.params.id);
      if (!game) {
        reply.status(404).send("Page not found");
        return;
      }

      return reply.view("views/game.njk", { game_id: game.id });
    }
  );

  fastify.get("/login", async function (request, reply) {
    await require_disconnected(request, reply);
    return reply.view("views/login.njk");
  });

  fastify.post<{
    Body: {
      email: string;
      password: string;
    };
  }>("/login", async function (request, reply) {
    await require_disconnected(request, reply);
    const entity_manager = request.entity_manager;
    const email = request.body.email;
    const password = request.body.password;

    const existing_user = await entity_manager.findOne(User, { email });
    if (!existing_user) {
      return reply.view("views/login.njk", {
        errors: ["Le mot de passe est incorrect ou le compte n'existe pas"],
        email,
      });
    }

    const is_password_correct = await verify(existing_user.password, password);
    if (!is_password_correct) {
      return reply.view("views/login.njk", {
        errors: ["Le mot de passe est incorrect ou le compte n'existe pas"],
        email,
      });
    }

    request.session.set("user_id", existing_user.id);

    return reply.redirect("/home");
  });

  fastify.get("/register", async function (request, reply) {
    await require_disconnected(request, reply);
    return reply.view("views/register.njk");
  });

  fastify.post<{
    Body: {
      email: string;
      password: string;
      password_verif: string;
    };
  }>("/register", async function (request, reply) {
    await require_disconnected(request, reply);
    const entity_manager = request.entity_manager;
    const email = request.body.email;
    const password = request.body.password;
    const password_verif = request.body.password_verif;

    if (password !== password_verif) {
      return reply.view("views/register.njk", {
        errors: ["Les mots de passe ne correspondent pas"],
        email,
      });
    }

    if (password.length < 4) {
      return reply.view("views/register.njk", {
        errors: [
          "Le mot de passe ne peut pas être vide et doit contenir au moins 4 caractères",
        ],
        email,
      });
    }

    const existing_user = await entity_manager.findOne(User, { email });
    if (existing_user) {
      return reply.view("views/register.njk", {
        errors: ["L'email est déjà utilisé"],
        email,
      });
    }

    const user = new User();
    user.email = email;
    user.password = await hash(password);
    await entity_manager.persistAndFlush(user);

    request.session.set("user_id", user.id);

    return reply.redirect("/home");
  });

  fastify.get("/logout", async (request, reply) => {
    request.session.set("user_id", null);
    return reply.redirect("/");
  });

  fastify.listen(3000, function (err, address) {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }

    console.log(`Server is now listening on ${address}`);
  });
}

initialize_web_server().catch((err) => console.log(err));

declare module "fastify" {
  interface FastifyRequest {
    logged_user: User | null;
    entity_manager: EntityManager;
  }
}
