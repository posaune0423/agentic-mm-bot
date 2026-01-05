/**
 * Post routes - HTTP endpoints for post operations.
 */

import { Hono } from "hono";

import type { PostAuthorizationService } from "../domain/services";
import type { PostRepository } from "../repositories/interfaces/post-repository";
import type { UserRepository } from "../repositories/interfaces/user-repository";
import {
  executeCreatePost,
  parseCreatePostInput,
} from "../usecases/create-post";
import {
  executeDeletePost,
  parseDeletePostInput,
} from "../usecases/delete-post";
import { executeGetPost, parseGetPostInput } from "../usecases/get-post";
import { executeListPosts, parseListPostsInput } from "../usecases/list-posts";
import {
  executePatchPost,
  executePutPost,
  parsePatchPostInput,
  parsePutPostInput,
} from "../usecases/update-post";
import { sendHttpError } from "../utils/http-error";

/**
 * Dependencies for post routes.
 */
export interface PostRoutesDeps {
  readonly postRepository: PostRepository;
  readonly userRepository: UserRepository;
  readonly postAuthorizationService: PostAuthorizationService;
}

/**
 * Create post routes with injected dependencies.
 * DI allows testing without mock.module().
 */
export const createPostRoutes = (deps: PostRoutesDeps) => {
  const posts = new Hono();

  /**
   * GET /posts
   * List all posts with pagination.
   * Optional query param: authorId
   */
  posts.get("/", async (c) => {
    const query = c.req.query();

    const inputResult = parseListPostsInput(query);

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeListPosts(
      { postRepository: deps.postRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({
      data: result.value.posts,
      pagination: result.value.pagination,
    });
  });

  /**
   * GET /posts/:id
   * Get a single post by ID.
   */
  posts.get("/:id", async (c) => {
    const inputResult = parseGetPostInput({ id: c.req.param("id") });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeGetPost(
      { postRepository: deps.postRepository },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.post });
  });

  /**
   * POST /posts
   * Create a new post.
   */
  posts.post("/", async (c) => {
    const body = await c.req.json();

    const inputResult = parseCreatePostInput(body);

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeCreatePost(
      {
        postRepository: deps.postRepository,
        userRepository: deps.userRepository,
      },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.post }, 201);
  });

  /**
   * PUT /posts/:id
   * Full update of a post.
   * TODO: Get userId from authentication middleware instead of request body
   */
  posts.put("/:id", async (c) => {
    const body = await c.req.json();

    const inputResult = parsePutPostInput({
      id: c.req.param("id"),
      userId: body.userId, // TODO: Get from auth middleware
      data: body,
    });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executePutPost(
      {
        postRepository: deps.postRepository,
        postAuthorizationService: deps.postAuthorizationService,
      },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.post });
  });

  /**
   * PATCH /posts/:id
   * Partial update of a post.
   * TODO: Get userId from authentication middleware instead of request body
   */
  posts.patch("/:id", async (c) => {
    const body = await c.req.json();

    const inputResult = parsePatchPostInput({
      id: c.req.param("id"),
      userId: body.userId, // TODO: Get from auth middleware
      data: body,
    });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executePatchPost(
      {
        postRepository: deps.postRepository,
        postAuthorizationService: deps.postAuthorizationService,
      },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.json({ data: result.value.post });
  });

  /**
   * DELETE /posts/:id
   * Soft delete a post.
   * TODO: Get userId from authentication middleware instead of request header
   */
  posts.delete("/:id", async (c) => {
    // TODO: Get userId from auth middleware
    const userId = c.req.header("X-User-Id") || "";

    const inputResult = parseDeletePostInput({
      id: c.req.param("id"),
      userId,
    });

    if (inputResult.isErr()) {
      return sendHttpError(c, inputResult.error);
    }

    const result = await executeDeletePost(
      {
        postRepository: deps.postRepository,
        postAuthorizationService: deps.postAuthorizationService,
      },
      inputResult.value,
    );

    if (result.isErr()) {
      return sendHttpError(c, result.error);
    }

    return c.body(null, 204);
  });

  return posts;
};
