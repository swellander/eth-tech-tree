import inquirer from "inquirer";
import chalk from "chalk";
import { loadChallenges, loadUserState, saveUserState } from "./stateManager";
import { testChallenge, submitChallenge, setupChallenge } from "../actions";
import { IChallenge, IUser, IUserChallenge } from "../types";
import fs from "fs";
import { pressEnterToContinue } from "./helpers";
import { getUser } from "../modules/api";

type Action = {
    label: string;
    action: () => Promise<void>;
}

type TreeNode = {
    label: string;
    name: string;
    children: TreeNode[];
    type: "header" | "challenge" | "quiz" | "capstone-project";
    completed?: boolean;
    level?: number;
    unlocked?: boolean;
    actions?: Action[];
    repo?: string;
    message?: string;
    recursive?: boolean;
}

function getNodeLabel(node: TreeNode, depth: string = ""): string {
    const { label, level, type, completed, unlocked } = node;
    const isHeader = type === "header";
    const isChallenge = type === "challenge";
    const isQuiz = type === "quiz";
    const isCapstoneProject = type === "capstone-project";


    if (isHeader) {
        return `${depth} ${chalk.blue(label)}`;
    } else if (!unlocked) {
        return `${depth} ${chalk.dim(label)}`;
    } else if (isChallenge) {
        return `${depth} ${label} ${completed ? "🏆" : ""}`;
    } else if (isQuiz) {
        return `${depth} ${label} 📜`;
    } else if (isCapstoneProject) {
        return`${depth} ${label} 💻`;
    } else {
        return `${depth} ${label}`;
    }
}

async function selectNode(node: TreeNode): Promise<void> {
    console.clear();
    
    const header = findHeader(globalTree, node) as TreeNode;
    // IF: type === challenge
    // Show description of challenge
    // Show menu for the following options:
    // download repository - Use create-eth to download repository using extensions
    //  - Show instructions for completing the challenge including a simple command to test their code
    // submit project, check if project passes tests then send proof of completion to the BG server, if it passes, mark the challenge as completed
    if (node.type !== "header" && !node.unlocked) {
        console.log("This challenge doesn't exist yet. 🤔 Consider contributing to the project here: https://github.com/BuidlGuidl/eth-tech-tree-challenges");
        await pressEnterToContinue();
        console.clear();
        await startVisualization(header);
    } else if (node.type === "challenge") {
        const backAction: Action = {
            label: "⤴️",
            action: async () => { 
                console.clear();
                await startVisualization(header);
            }
        }
        const actions = [backAction].concat((node.actions as Action[]).map(action => action));
        const choices = actions.map(action => action.label);
        const message = `${chalk.red(node.label)}
${node.message}
`;
        const actionPrompt = {
            type: "list",
            name: "selectedAction",
            message,
            choices,
            default: 1
        };
        const { selectedAction } = await inquirer.prompt([actionPrompt]);
        const selectedActionIndex = actions.findIndex(action => action.label === selectedAction);
        if (selectedActionIndex !== undefined && selectedActionIndex >= 0) {
            await actions[selectedActionIndex].action();
        }
    }

    // IF: type === reference
    // Show link to reference material
    // Provide option to mark as completed

    // IF: type === personal-challenge
    // Show description of challenge

}

let globalTree: TreeNode;

export async function startVisualization(currentNode?: TreeNode): Promise<void> {
    if (!currentNode) {
        globalTree = buildTree();
        currentNode = Object.assign({}, globalTree);
    }

    function getChoicesAndActions(node: TreeNode): { choices: string[], actions: TreeNode[] } {
        const choices: string[] = [];
        const actions: TreeNode[] = [];

        if (!node.recursive) {
            choices.push(...node.children.map(child => getNodeLabel(child)));
            actions.push(...node.children);
            return { choices, actions };
        }

        const getChoicesAndActionsRecursive = (node: TreeNode, isLast: boolean = false, depth: string = "") => {
            if (node.type !== "header") {
                if (!isLast) {
                    depth += "├─";
                } else {
                    depth += "└─";
                }
            }
                choices.push(getNodeLabel(node, depth));
                actions.push(node);
                // Replace characters in the continuing pattern
                if (depth.length) {
                    depth = depth.replace(/├─/g, "│ ");
                    depth = depth.replace(/└─/g, "  ");
                }
                // Add spaces so that the labels are spaced out
                const depthDivisor = node.type === "header" ? 5 : 2;
                depth += Array(Math.floor(node.label.length / depthDivisor)).fill(" ").join("");
            node.children.forEach((child, i, siblings) => getChoicesAndActionsRecursive(child, i === siblings.length - 1, depth));
        };

        getChoicesAndActionsRecursive(node);

        return { choices, actions };
    }

    const { choices, actions } = getChoicesAndActions(currentNode);
    const parent = findParent(globalTree, currentNode) as TreeNode;
    let defaultChoice = 0;
    // Add a back option if not at the root
    if (parent) {
        choices.unshift(" ⤴️");
        actions.unshift(parent);
        defaultChoice = 1;
    }
    const directionsPrompt = {
        type: "list",
        loop: false,
        name: "selectedNodeIndex",
        message: parent ? "Select a challenge" : "Select a category",
        choices,
        default: defaultChoice
    };
    const answers = await inquirer.prompt([directionsPrompt]);
    const selectedIndex = choices.indexOf(answers.selectedNodeIndex);
    const selectedNode = actions[selectedIndex];
    await selectNode(selectedNode);
    if (selectedNode.type === "header") {
        await startVisualization(selectedNode);
    }
}

function findParent(allNodes: TreeNode, targetNode: TreeNode): TreeNode | undefined {
    if (allNodes.children.includes(targetNode)) {
        return allNodes;
    } else {
        for (const childNode of allNodes.children) {
            const parent = findParent(childNode, targetNode);
            if (parent) return parent;
        }
        return undefined;
    }
}

function findHeader(allNodes: TreeNode, targetNode: TreeNode): TreeNode | undefined {
        let parent = findParent(allNodes, targetNode);
        while (true) {
            if (!parent) {
                return allNodes;
            }
            if (parent?.type === "header") {
                return parent;
            }
            parent = findParent(allNodes, parent);
        }    
}

// Nesting Magic - Recursive function to build nested tree structure
function nestingMagic(challenges: any[], parentName: string | undefined = undefined): TreeNode[] {
    const tree: TreeNode[] = [];
    for (let challenge of challenges) {
        if (challenge.parentName === parentName) {
            // Recursively call NestingMagic for each child
            challenge.children = nestingMagic(challenges, challenge.name);
            tree.push(challenge);
        }
    }
    return tree;
}

export function buildTree(): TreeNode {
    const userState = loadUserState();
    const { challenges: userChallenges } = userState;
    const tree: TreeNode[] = [];
    const challenges = loadChallenges();
    const tags = challenges.reduce((acc: string[], challenge: any) => {
        return Array.from(new Set(acc.concat(challenge.tags)));
    }, []);

    for (let tag of tags) {
            const filteredChallenges = challenges.filter((challenge: IChallenge) => challenge.tags.includes(tag));
            let completedCount = 0;
            const transformedChallenges = filteredChallenges.map((challenge: IChallenge) => {
                const { label, name, level, type, childrenNames, enabled: unlocked, description } = challenge;
                const parentName = challenges.find((c: any) => c.childrenNames?.includes(name))?.name;
                const completed = userChallenges.find((c: IUserChallenge) => c.challengeName === name)?.status === "success";
                if (completed) {
                    completedCount++;
                }
                // Build selection actions
                const actions: Action[] = getActions(userState, challenge);

                return { label, name, level, type, actions, completed, childrenNames, parentName, unlocked, message: description };
            });
            const nestedChallenges = nestingMagic(transformedChallenges);

            const sortedByUnlocked = nestedChallenges.sort((a: TreeNode, b: TreeNode) => {return a.unlocked ? -1 : 1});
            
        tree.push({
            type: "header",
            label: `${tag} ${chalk.green(`(${completedCount}/${filteredChallenges.length})`)}`,
            name: `${tag.toLowerCase()}`,
            children: sortedByUnlocked,
            recursive: true
        });
    }
    // Remove any categories without challenges
    const enabledCategories = tree.filter((category: TreeNode) => category.children.length > 0);
    const mainMenu: TreeNode = {
        label: "Main Menu",
        name: "main-menu",
        type: "header",
        children: enabledCategories,
    };
    
    return mainMenu;
}

function getActions(userState: IUser, challenge: IChallenge): Action[] {
    const actions: Action[] = [];
    const { address, installLocation } = userState;
    const { type, name } = challenge;
    if (type === "challenge") {
        const targetDir = `${installLocation}/${name}`;
        if (!fs.existsSync(targetDir)) {
            actions.push({
                label: "Setup Challenge Repository",
                action: async () => {
                    console.clear();
                    await setupChallenge(name, installLocation);
                    // Rebuild the tree
                    globalTree = buildTree();
                    // Wait for enter key
                    await pressEnterToContinue();
                    // Return to challenge menu
                    const challengeNode = findNode(globalTree, name) as TreeNode;
                    await selectNode(challengeNode);
                }
            });
        } else {
            actions.push({
                label: "Test Challenge",
                action: async () => {
                    console.clear();
                    await testChallenge(name);
                    // Wait for enter key
                    await pressEnterToContinue();
                    // Return to challenge menu
                    const challengeNode = findNode(globalTree, name) as TreeNode;
                    await selectNode(challengeNode);
                }
            });
            actions.push({
                label: "Submit Completed Challenge",
                action: async () => {
                    console.clear();
                    // Submit the challenge
                    await submitChallenge(name);
                    // Fetch users challenge state from the server
                    const newUserState = await getUser(address);
                    userState.challenges = newUserState.challenges;
                    // Save the new user state locally
                    await saveUserState(userState);
                    // Rebuild the tree
                    globalTree = buildTree();
                    // Wait for enter key
                    await pressEnterToContinue();
                    // Return to challenge menu
                    const challengeNode = findNode(globalTree, name) as TreeNode;
                    await selectNode(challengeNode);
                }
            });
        }                    
    } else if (type === "quiz") {
        actions.push({
            label: "Mark as Read",
            action: async () => {
                console.log("Marking as read...");
            }
        });
    } else if (type === "capstone-project") {
        actions.push({
            label: "Submit Project",
            action: async () => {
                console.log("Submitting project...");
            }
        });
    }
    return actions;
};

function findNode(globalTree: TreeNode, name: string): TreeNode | undefined {
    // Descend the tree until the node is found
    if (globalTree.name === name) {
        return globalTree;
    }
    for (const child of globalTree.children) {
        const node = findNode(child, name);
        if (node) {
            return node;
        }
    }
}
