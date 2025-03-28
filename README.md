
# CodeGraph: Unleash Your Code’s Hidden Connections with Neo4j and AI 🚀

Welcome to **CodeGraph**—a groundbreaking tool that transforms your TypeScript and JavaScript codebases into stunning, interactive graphs using Neo4j. Visualize every function call, class inheritance, and module dependency like never before, with AI-powered insights to supercharge your understanding. Whether you're a developer, architect, or AI enthusiast, CodeGraph turns your code into a masterpiece of connections—explored by humans and machines alike.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/yourusername/codegraph/actions)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/yourusername/codegraph/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/yourusername/codegraph/blob/main/LICENSE)
[![Stars](https://img.shields.io/github/stars/yourusername/codegraph?style=social)](https://github.com/yourusername/codegraph/stargazers)

---

## 🌟 What Makes CodeGraph Awesome?

- **Code as Art**: Parse functions, classes, interfaces, and more with `ts-morph`, then watch them come alive in a Neo4j graph.
- **Connections Unveiled**: Map relationships—function calls, inheritance, imports—across your entire codebase with precision.
- **AI Magic**: Leverage AI to analyze patterns, suggest improvements, and uncover insights no human could spot alone.
- **Scalable Power**: Handle massive codebases with batch processing and efficient Neo4j storage.

Imagine exploring your code’s DNA in a visual graph, where every node and edge tells a story—and AI helps you decode it. That’s CodeGraph.

---

## 🔥 Features

- **Comprehensive Parsing**: Extracts everything—functions, classes, variables, and beyond—using `ts-morph`.
- **Relationship Mapping**: Tracks calls, inheritance, imports, and more, stored as a dynamic Neo4j graph.
- **Neo4j Visualization**: Query and explore your codebase in Neo4j’s sleek interface.
- **AI Insights**: Get smart suggestions for refactoring and optimization (yes, the future is here!).
- **Extensible**: Add support for new languages or custom analyses with ease.

---

[![CodeGraph Demo](/image.png)](https://www.youtube.com/watch?v=MpFzfRAZ_Y0)

---

## 🛠️ Installation

Get started in minutes:

1. **Clone the Repo**:
   ```bash
   git clone https://github.com/yourusername/codegraph.git
   cd codegraph
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Neo4j**:
   - Download [Neo4j Desktop](https://neo4j.com/download/) or use [Neo4j Aura](https://neo4j.com/cloud/aura/).
   - Create a database and grab your connection details (URI, username, password).

4. **Configure Environment**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Update `.env` with your Neo4j credentials:
     ```
     NEO4J_URI=bolt://localhost:7687
     NEO4J_USERNAME=neo4j
     NEO4J_PASSWORD=yourpassword
     NEO4J_DATABASE=codegraph
     ```

---

## 🚀 Usage

Analyze your codebase with a single command:

```bash
npm run analyze /path/to/your/codebase
```

### Options

- `-e, --extensions <exts>`: File extensions to scan (e.g., `.ts,.js`).
- `-i, --ignore <patterns>`: Skip directories like `node_modules,dist`.
- `--update-schema`: Refresh Neo4j schema before analysis.
- `--reset-db`: Wipe the database clean for a fresh start.

Run `npm run analyze -- --help` for more details.

---

## ⚙️ Configuration

Tweak settings in `.env`:

- `NEO4J_URI`: Your Neo4j connection string.
- `NEO4J_USERNAME` & `NEO4J_PASSWORD`: Your credentials.
- `ANALYSIS_BATCH_SIZE`: Batch size for parsing (default: 100).
- `LOG_LEVEL`: Set verbosity (e.g., `info`, `debug`).

---

## 🎨 Examples

Run CodeGraph on your project, then open Neo4j Browser to see this:

![CodeGraph Example](/neo4jimage.png)

- **Blue Nodes**: Functions.
- **Orange Nodes**: Classes.
- **Green Nodes**: Variables.

Query it like:
```cypher
MATCH (f:Function)-[:CALLS]->(g:Function)
RETURN f.name, g.name
```

---

## 🌍 Why CodeGraph?

- **See the Unseen**: Reveal hidden dependencies and structure.
- **AI-Powered Future**: Insights that evolve with your code.
- **Scales with You**: From small scripts to enterprise monoliths.
- **Community-Driven**: Built to grow with your contributions.

---

## 🤝 Contributing

Love CodeGraph? Help make it better!

1. Fork the repo.
2. Create a feature branch (`git checkout -b feature/amazing-idea`).
3. Commit your changes (`git commit -m "Add amazing idea"`).
4. Push it (`git push origin feature/amazing-idea`).
5. Open a Pull Request!

Check [CONTRIBUTING.md](CONTRIBUTING.md) for more.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE)—free to use, modify, and share.

---

## 🌟 Star Us!

If CodeGraph blows your mind, give us a ⭐ on GitHub! Let’s make code visualization the next big thing—together.

