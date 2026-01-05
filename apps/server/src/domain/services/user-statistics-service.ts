/**
 * User Statistics Domain Service.
 *
 * Calculates and aggregates statistics about users and their posts.
 * This service coordinates multiple repositories to compute derived data.
 */

import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";

import type { NotFoundError, UnexpectedError } from "../errors";

type RepoError = {
  readonly message: string;
};

type User = {
  readonly id: string;
  readonly deletedAt: Date | null;
};

type Post = {
  readonly content: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
};

type UserReader = {
  findById(id: string): Promise<Result<User | null, RepoError>>;
  findAll(options: {
    readonly limit: number;
    readonly offset: number;
  }): Promise<
    Result<
      { readonly users: readonly User[]; readonly total: number },
      RepoError
    >
  >;
};

type PostLister = {
  findAll(options: {
    readonly limit: number;
    readonly offset: number;
    readonly authorId?: string;
  }): Promise<
    Result<
      { readonly posts: readonly Post[]; readonly total: number },
      RepoError
    >
  >;
};

/**
 * User statistics data.
 */
export interface UserStatistics {
  readonly user: User;
  readonly totalPosts: number;
  readonly activePosts: number;
  readonly deletedPosts: number;
  readonly averagePostLength: number;
  readonly firstPostDate: Date | null;
  readonly lastPostDate: Date | null;
}

/**
 * Multiple users statistics summary.
 */
export interface UsersStatisticsSummary {
  readonly totalUsers: number;
  readonly activeUsers: number;
  readonly deletedUsers: number;
  readonly totalPosts: number;
  readonly averagePostsPerUser: number;
}

/**
 * Error types for statistics service.
 */
export type StatisticsServiceError = NotFoundError | UnexpectedError;

/**
 * User Statistics Service interface.
 * Encapsulates statistics calculation logic.
 */
export interface UserStatisticsService {
  /**
   * Get detailed statistics for a specific user.
   */
  getUserStatistics(
    userId: string,
  ): Promise<Result<UserStatistics, StatisticsServiceError>>;

  /**
   * Get summary statistics for all users.
   */
  getUsersSummary(): Promise<
    Result<UsersStatisticsSummary, StatisticsServiceError>
  >;
}

/**
 * Dependencies for creating UserStatisticsService.
 */
export interface CreateUserStatisticsServiceDeps {
  readonly userRepository: UserReader;
  readonly postRepository: PostLister;
}

/**
 * Create UserStatisticsService instance.
 */
export function createUserStatisticsService(
  deps: CreateUserStatisticsServiceDeps,
): UserStatisticsService {
  const { userRepository, postRepository } = deps;

  return {
    async getUserStatistics(userId) {
      // Find user
      const userResult = await userRepository.findById(userId);
      if (userResult.isErr()) {
        return err({
          type: "UnexpectedError",
          message: `Failed to find user: ${userResult.error.message}`,
        });
      }

      const user = userResult.value;
      if (!user) {
        return err({
          type: "NotFoundError",
          message: "User not found",
          resource: "User",
          id: userId,
        });
      }

      // Get all posts by user (including deleted ones for statistics)
      const postsResult = await postRepository.findAll({
        authorId: userId,
        limit: 1000, // Reasonable limit for statistics
        offset: 0,
      });

      if (postsResult.isErr()) {
        return err({
          type: "UnexpectedError",
          message: `Failed to fetch user posts: ${postsResult.error.message}`,
        });
      }

      const { posts } = postsResult.value;

      // Calculate statistics
      const activePosts = posts.filter((p) => p.deletedAt === null);
      const deletedPosts = posts.filter((p) => p.deletedAt !== null);

      const totalPosts = posts.length;
      const activePostsCount = activePosts.length;
      const deletedPostsCount = deletedPosts.length;

      // Calculate average post length (only active posts)
      const averagePostLength =
        activePostsCount > 0 ?
          activePosts.reduce((sum, post) => sum + post.content.length, 0) /
          activePostsCount
        : 0;

      // Find first and last post dates
      const sortedPosts = [...posts].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const firstPostDate =
        sortedPosts.length > 0 ? sortedPosts[0].createdAt : null;
      const lastPostDate =
        sortedPosts.length > 0 ?
          sortedPosts[sortedPosts.length - 1].createdAt
        : null;

      return ok({
        user,
        totalPosts,
        activePosts: activePostsCount,
        deletedPosts: deletedPostsCount,
        averagePostLength: Math.round(averagePostLength),
        firstPostDate,
        lastPostDate,
      });
    },

    async getUsersSummary() {
      // Get all users
      const usersResult = await userRepository.findAll({
        limit: 10000, // Reasonable limit
        offset: 0,
      });

      if (usersResult.isErr()) {
        return err({
          type: "UnexpectedError",
          message: `Failed to fetch users: ${usersResult.error.message}`,
        });
      }

      const { users, total: totalUsers } = usersResult.value;

      // Count active and deleted users
      const activeUsers = users.filter((u) => u.deletedAt === null).length;
      const deletedUsers = users.filter((u) => u.deletedAt !== null).length;

      // Get all posts
      const postsResult = await postRepository.findAll({
        limit: 100000, // Large limit for summary
        offset: 0,
      });

      if (postsResult.isErr()) {
        return err({
          type: "UnexpectedError",
          message: `Failed to fetch posts: ${postsResult.error.message}`,
        });
      }

      const { total: totalPosts } = postsResult.value;

      // Calculate average posts per user
      const averagePostsPerUser =
        activeUsers > 0 ? totalPosts / activeUsers : 0;

      return ok({
        totalUsers,
        activeUsers,
        deletedUsers,
        totalPosts,
        averagePostsPerUser: Math.round(averagePostsPerUser * 100) / 100, // Round to 2 decimal places
      });
    },
  };
}
