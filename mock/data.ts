export type Difficulty = "Easy" | "Medium" | "Hard";
export type ProblemStatus = "solved" | "attempted" | "unsolved";
export type ContestStatus = "Upcoming" | "Registration Open" | "Active" | "Finished";
export type Verdict =
  | "Pending"
  | "Running"
  | "Accepted"
  | "Wrong Answer"
  | "Time Limit Exceeded"
  | "Memory Limit Exceeded"
  | "Runtime Error"
  | "Compilation Error";

export interface Problem {
  id: number;
  title: string;
  difficulty: Difficulty;
  category: string;
  acceptance: string;
  status: ProblemStatus;
  statement: string;
  input: string;
  output: string;
  constraints: string;
  sampleInput: string;
  sampleOutput: string;
  timeLimit: string;
  memoryLimit: string;
}

export interface Contest {
  id: string;
  title: string;
  description: string;
  status: ContestStatus;
  start: string;
  end: string;
  duration: string;
  problems: number;
  participants: number;
  registered: boolean;
}

export const problems: Problem[] = [
  { id: 1, title: "Two Sum", difficulty: "Easy", category: "Arrays", acceptance: "85.2%", status: "solved", statement: "Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.", input: "The first line contains nums. The second line contains target.", output: "Print the two zero-based indices in any order.", constraints: "2 <= nums.length <= 10^4; -10^9 <= nums[i] <= 10^9", sampleInput: "nums = [2, 7, 11, 15]\ntarget = 9", sampleOutput: "[0, 1]", timeLimit: "1 sec", memoryLimit: "256 MB" },
  { id: 2, title: "Longest Substring", difficulty: "Medium", category: "Strings", acceptance: "68.4%", status: "attempted", statement: "Find the length of the longest substring without repeating characters.", input: "A single line containing a string s.", output: "Print the maximum length of a substring with unique characters.", constraints: "0 <= s.length <= 5 * 10^4", sampleInput: "s = \"kottayam\"", sampleOutput: "6", timeLimit: "1 sec", memoryLimit: "256 MB" },
  { id: 3, title: "Merge K Sorted Lists", difficulty: "Hard", category: "Arrays", acceptance: "45.1%", status: "unsolved", statement: "Merge k sorted linked lists into one sorted list and return its head.", input: "The number of lists followed by each sorted list.", output: "Print the merged values in non-decreasing order.", constraints: "1 <= k <= 10^4; total nodes <= 10^5", sampleInput: "lists = [[1,4],[1,3],[2,6]]", sampleOutput: "[1,1,2,3,4,6]", timeLimit: "2 sec", memoryLimit: "512 MB" },
  { id: 4, title: "Binary Tree Traversal", difficulty: "Easy", category: "Trees", acceptance: "78.9%", status: "solved", statement: "Return the level-order traversal of a binary tree.", input: "A serialized binary tree with null nodes represented by -1.", output: "Print values level by level.", constraints: "1 <= nodes <= 10^4", sampleInput: "root = [3,9,20,-1,-1,15,7]", sampleOutput: "[[3],[9,20],[15,7]]", timeLimit: "1 sec", memoryLimit: "256 MB" },
  { id: 5, title: "Word Break", difficulty: "Medium", category: "DP", acceptance: "52.3%", status: "attempted", statement: "Determine whether a string can be segmented into dictionary words.", input: "A string s followed by a list of dictionary words.", output: "Print YES if segmentation is possible, otherwise NO.", constraints: "1 <= s.length <= 300; dictionary size <= 1000", sampleInput: "s = \"kojjudge\"\nwords = [\"koj\", \"judge\"]", sampleOutput: "YES", timeLimit: "1 sec", memoryLimit: "256 MB" },
  { id: 6, title: "Course Schedule", difficulty: "Medium", category: "Graphs", acceptance: "61.7%", status: "unsolved", statement: "Check whether all courses can be completed given prerequisite pairs.", input: "The course count and prerequisite edges.", output: "Print YES when the dependency graph is acyclic.", constraints: "1 <= courses <= 10^5", sampleInput: "courses = 2\nprerequisites = [[1,0]]", sampleOutput: "YES", timeLimit: "2 sec", memoryLimit: "256 MB" },
  { id: 7, title: "Maximum Subarray", difficulty: "Easy", category: "DP", acceptance: "82.5%", status: "solved", statement: "Find the contiguous subarray with the largest sum.", input: "A line containing an integer array.", output: "Print the largest possible subarray sum.", constraints: "1 <= n <= 10^5", sampleInput: "nums = [-2,1,-3,4,-1,2,1,-5,4]", sampleOutput: "6", timeLimit: "1 sec", memoryLimit: "256 MB" },
  { id: 8, title: "Alien Dictionary", difficulty: "Hard", category: "Graphs", acceptance: "38.6%", status: "unsolved", statement: "Infer a valid character ordering from a sorted alien dictionary.", input: "The number of words followed by the sorted words.", output: "Print one valid character ordering.", constraints: "1 <= words <= 10^4", sampleInput: "words = [\"wrt\",\"wrf\",\"er\",\"ett\",\"rftt\"]", sampleOutput: "wertf", timeLimit: "2 sec", memoryLimit: "512 MB" },
];

export const contests: Contest[] = [
  { id: "weekly-42", title: "Weekly Challenge #42", description: "Curated algorithmic puzzles for the weekly KOJ sprint.", status: "Active", start: "Today, 18:00 IST", end: "Today, 20:00 IST", duration: "2 hours", problems: 5, participants: 128, registered: true },
  { id: "winter-2026", title: "Winter Championship", description: "The flagship championship covering algorithms, graphs, and dynamic programming.", status: "Registration Open", start: "24 Aug 2026, 10:00 IST", end: "24 Aug 2026, 15:00 IST", duration: "5 hours", problems: 10, participants: 0, registered: false },
  { id: "speed-friday", title: "Speed Coding Friday", description: "Quick-fire problems for contestants who thrive under tight deadlines.", status: "Upcoming", start: "28 Aug 2026, 19:00 IST", end: "28 Aug 2026, 20:00 IST", duration: "1 hour", problems: 6, participants: 0, registered: false },
  { id: "monsoon-mayhem", title: "Monsoon Mayhem", description: "A finished contest with tough graph and DP problems.", status: "Finished", start: "02 Aug 2026, 10:00 IST", end: "02 Aug 2026, 14:00 IST", duration: "4 hours", problems: 7, participants: 234, registered: true },
];

export const leaderboard = [
  { rank: 1, username: "Shiv", solved: ["AC", "AC", "--", "AC"], solvedCount: 3, penalty: 142 },
  { rank: 2, username: "Hari", solved: ["AC", "--", "AC", "AC"], solvedCount: 3, penalty: 157 },
  { rank: 3, username: "Anjali", solved: ["AC", "AC", "AC", "--"], solvedCount: 3, penalty: 181 },
  { rank: 4, username: "Arun", solved: ["AC", "WA", "--", "AC"], solvedCount: 2, penalty: 96 },
  { rank: 5, username: "Meera", solved: ["--", "AC", "--", "AC"], solvedCount: 2, penalty: 124 },
];

export const adminProblems = problems.slice(0, 5).map((problem) => ({ ...problem, lifecycle: problem.id < 4 ? "Published" : "Contest-Active" }));
export const adminUsers = [
  { username: "Shiv", email: "shiv@iiitkottayam.ac.in", role: "Contestant" },
  { username: "Meera", email: "meera@iiitkottayam.ac.in", role: "Problem Setter" },
  { username: "admin", email: "admin@iiitkottayam.ac.in", role: "Admin" },
];
