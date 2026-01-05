/**
 * Unit tests for UserStatisticsService.
 */

import { describe, expect, it } from "bun:test";
import { ok } from "neverthrow";

import { createUserStatisticsService } from "../../../../src/domain/services/user-statistics-service";

describe("UserStatisticsService", () => {
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

  const mockDeletedUser = {
    ...mockUser,
    id: "user-3",
    email: "deleted@example.com",
    deletedAt: new Date("2024-01-02"),
  };

  const mockPosts = [
    {
      id: "post-1",
      title: "First Post",
      content: "This is the first post content",
      authorId: "user-1",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      deletedAt: null,
    },
    {
      id: "post-2",
      title: "Second Post",
      content: "This is the second post content with more text",
      authorId: "user-1",
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
      deletedAt: null,
    },
    {
      id: "post-3",
      title: "Deleted Post",
      content: "This post was deleted",
      authorId: "user-1",
      createdAt: new Date("2024-01-03"),
      updatedAt: new Date("2024-01-03"),
      deletedAt: new Date("2024-01-04"),
    },
  ];

  describe("getUserStatistics", () => {
    it("should calculate statistics for user with posts", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
        findAll: async () => ok({ users: [mockUser], total: 1 }),
      };

      const mockPostRepository = {
        findAll: async (options: { authorId?: string }) => {
          if (options.authorId === "user-1") {
            return ok({
              posts: mockPosts,
              total: mockPosts.length,
            });
          }
          return ok({ posts: [], total: 0 });
        },
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUserStatistics("user-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const stats = result.value;
        expect(stats.user.id).toBe("user-1");
        expect(stats.totalPosts).toBe(3);
        expect(stats.activePosts).toBe(2);
        expect(stats.deletedPosts).toBe(1);
        expect(stats.averagePostLength).toBeGreaterThan(0);
        expect(stats.firstPostDate).toEqual(new Date("2024-01-01"));
        expect(stats.lastPostDate).toEqual(new Date("2024-01-03"));
      }
    });

    it("should handle user with no posts", async () => {
      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockOtherUser.id) {
            return ok(mockOtherUser);
          }
          return ok(null);
        },
        findAll: async () => ok({ users: [mockOtherUser], total: 1 }),
      };

      const mockPostRepository = {
        findAll: async () => ok({ posts: [], total: 0 }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUserStatistics("user-2");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const stats = result.value;
        expect(stats.user.id).toBe("user-2");
        expect(stats.totalPosts).toBe(0);
        expect(stats.activePosts).toBe(0);
        expect(stats.deletedPosts).toBe(0);
        expect(stats.averagePostLength).toBe(0);
        expect(stats.firstPostDate).toBeNull();
        expect(stats.lastPostDate).toBeNull();
      }
    });

    it("should return error when user does not exist", async () => {
      const mockUserRepository = {
        findById: async () => ok(null),
        findAll: async () => ok({ users: [], total: 0 }),
      };

      const mockPostRepository = {
        findAll: async () => ok({ posts: [], total: 0 }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUserStatistics("nonexistent-user");

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("NotFoundError");
      }
    });

    it("should calculate correct average post length", async () => {
      const postsWithKnownLengths = [
        {
          id: "post-1",
          title: "Post 1",
          content: "12345", // 5 chars
          authorId: "user-1",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deletedAt: null,
        },
        {
          id: "post-2",
          title: "Post 2",
          content: "1234567890", // 10 chars
          authorId: "user-1",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deletedAt: null,
        },
      ];

      const mockUserRepository = {
        findById: async (id: string) => {
          if (id === mockUser.id) {
            return ok(mockUser);
          }
          return ok(null);
        },
        findAll: async () => ok({ users: [mockUser], total: 1 }),
      };

      const mockPostRepository = {
        findAll: async () =>
          ok({
            posts: postsWithKnownLengths,
            total: postsWithKnownLengths.length,
          }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUserStatistics("user-1");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Average of 5 and 10 is 7.5, rounded to 8
        expect(result.value.averagePostLength).toBe(8);
      }
    });
  });

  describe("getUsersSummary", () => {
    it("should calculate summary statistics for all users", async () => {
      const allUsers = [mockUser, mockOtherUser, mockDeletedUser];

      const mockUserRepository = {
        findAll: async () =>
          ok({
            users: allUsers,
            total: allUsers.length,
          }),
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findAll: async () =>
          ok({
            posts: mockPosts,
            total: mockPosts.length,
          }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUsersSummary();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.totalUsers).toBe(3);
        expect(summary.activeUsers).toBe(2);
        expect(summary.deletedUsers).toBe(1);
        expect(summary.totalPosts).toBe(3);
        expect(summary.averagePostsPerUser).toBeGreaterThan(0);
      }
    });

    it("should handle empty database", async () => {
      const mockUserRepository = {
        findAll: async () => ok({ users: [], total: 0 }),
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findAll: async () => ok({ posts: [], total: 0 }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUsersSummary();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const summary = result.value;
        expect(summary.totalUsers).toBe(0);
        expect(summary.activeUsers).toBe(0);
        expect(summary.deletedUsers).toBe(0);
        expect(summary.totalPosts).toBe(0);
        expect(summary.averagePostsPerUser).toBe(0);
      }
    });

    it("should calculate correct average posts per user", async () => {
      const users = [mockUser, mockOtherUser]; // 2 active users

      const mockUserRepository = {
        findAll: async () =>
          ok({
            users,
            total: users.length,
          }),
        findById: async () => ok(null),
      };

      const mockPostRepository = {
        findAll: async () =>
          ok({
            posts: mockPosts.slice(0, 2), // 2 posts
            total: 2,
          }),
      };

      const service = createUserStatisticsService({
        userRepository: mockUserRepository,
        postRepository: mockPostRepository,
      });

      const result = await service.getUsersSummary();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 2 posts / 2 active users = 1.0
        expect(result.value.averagePostsPerUser).toBe(1.0);
      }
    });
  });
});
