/**
 * Unit tests for PostAuthorizationService.
 */

import { describe, expect, it } from "bun:test";
import { ok } from "neverthrow";

import { createPostAuthorizationService } from "../../../../src/domain/services/post-authorization-service";

describe("PostAuthorizationService", () => {
  // Mock data
  const mockUser = {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: new Date("2024-01-01"),
    image: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    deletedAt: null,
  };

  const mockOtherUser = {
    ...mockUser,
    id: "user-2",
    email: "other@example.com",
  };

  const mockPost = {
    id: "post-1",
    title: "Test Post",
    content: "Test content",
    authorId: "user-1",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    deletedAt: null,
  };

  const mockDeletedPost = {
    ...mockPost,
    id: "post-2",
    deletedAt: new Date("2024-01-02"),
  };

  describe("canEditPost", () => {
    it("should allow author to edit their own post", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockPost.id) {
            return ok(mockPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canEditPost("user-1", "post-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isAuthorized).toBe(true);
      }
    });

    it("should deny non-author from editing post", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockOtherUser.id) {
            return ok(mockOtherUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockPost.id) {
            return ok(mockPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canEditPost("user-2", "post-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isAuthorized).toBe(false);
        expect(result.value.reason).toContain("Only the author");
      }
    });

    it("should return error when user does not exist", async () => {
      const mockUserRepository = {
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findById: async () => ok(null),
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canEditPost("nonexistent-user", "post-1");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("UnauthorizedError");
      }
    });

    it("should return error when post does not exist", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async () => ok(null),
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canEditPost("user-1", "nonexistent-post");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
      }
    });

    it("should return error when post is deleted", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockDeletedPost.id) {
            return ok(mockDeletedPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canEditPost("user-1", "post-2");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
        expect(result.error.message).toContain("deleted");
      }
    });
  });

  describe("canDeletePost", () => {
    it("should allow author to delete their own post", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockPost.id) {
            return ok(mockPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canDeletePost("user-1", "post-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isAuthorized).toBe(true);
      }
    });

    it("should deny non-author from deleting post", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockOtherUser.id) {
            return ok(mockOtherUser);
          }
          return ok(null);
        },
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockPost.id) {
            return ok(mockPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canDeletePost("user-2", "post-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isAuthorized).toBe(false);
        expect(result.value.reason).toContain("Only the author");
      }
    });
  });

  describe("canViewPost", () => {
    it("should allow viewing non-deleted post", async () => {
      const mockUserRepository = {
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockPost.id) {
            return ok(mockPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canViewPost("post-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.isAuthorized).toBe(true);
      }
    });

    it("should return error when post does not exist", async () => {
      const mockUserRepository = {
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findById: async () => ok(null),
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canViewPost("nonexistent-post");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
      }
    });

    it("should return error when post is deleted", async () => {
      const mockUserRepository = {
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findById: async (id: string) => {
          if (id === mockDeletedPost.id) {
            return ok(mockDeletedPost);
          }
          return ok(null);
        },
      };

      const service = createPostAuthorizationService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.canViewPost("post-2");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
      }
    });
  });
});
