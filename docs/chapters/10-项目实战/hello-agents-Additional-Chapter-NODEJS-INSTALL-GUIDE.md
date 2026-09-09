# Node.js 和 npx 安装教程

> **资料来源**：[Hello-Agents](https://github.com/datawhalechina/hello-agents) · 原文件：`Additional-Chapter/NODEJS_INSTALL_GUIDE.md`。


### 📋 目录

- [为什么需要安装 Node.js？](#为什么需要安装-nodejs)
- [Windows 安装教程](#windows-安装教程)
- [macOS 安装教程](#macos-安装教程)
- [Linux 安装教程](#linux-安装教程)
- [验证安装](#验证安装)
- [常见问题](#常见问题)

---

### 为什么需要安装 Node.js？

在第十章的MCP协议学习中，我们需要使用社区提供的MCP服务器，这些服务器大多数是用JavaScript/TypeScript编写的，需要Node.js运行环境。

**安装Node.js后你将获得**：
- ✅ **node**: JavaScript运行时
- ✅ **npm**: Node包管理器（Node Package Manager）
- ✅ **npx**: npm包执行器（自动下载并运行npm包）

**npx的作用**：
```bash
## 传统方式：需要先安装再运行
npm install -g @modelcontextprotocol/server-filesystem
server-filesystem

## 使用npx：自动下载并运行（推荐）
npx @modelcontextprotocol/server-filesystem
```

---

### Windows 安装教程

#### 方式1：官方安装包（推荐）

##### 步骤1：下载安装包

访问Node.js官网：https://nodejs.org/

你会看到两个版本：
- **LTS（长期支持版）**：推荐大多数用户使用 ✅
- **Current（最新版）**：包含最新特性

**推荐下载LTS版本**（例如：20.x.x LTS）

##### 步骤2：运行安装程序

1. 双击下载的 `.msi` 文件
2. 点击 "Next" 开始安装
3. 接受许可协议
4. 选择安装路径（默认即可）
5. **重要**：确保勾选以下选项：
   - ✅ Node.js runtime
   - ✅ npm package manager
   - ✅ Add to PATH（自动添加到环境变量）
6. 点击 "Install" 开始安装
7. 等待安装完成，点击 "Finish"

##### 步骤3：验证安装

打开 **PowerShell** 或 **命令提示符**（CMD），输入：

```powershell
## 检查Node.js版本
node -v
## 应该显示：v20.x.x

## 检查npm版本
npm -v
## 应该显示：10.x.x

## 检查npx版本
npx -v
## 应该显示：10.x.x
```

如果都能正常显示版本号，说明安装成功！✅

---

### macOS 安装教程

#### 方式1：官方安装包

##### 步骤1：下载安装包

访问：https://nodejs.org/

下载 **LTS版本** 的 `.pkg` 文件

##### 步骤2：安装

1. 双击 `.pkg` 文件
2. 按照安装向导提示操作
3. 输入管理员密码
4. 完成安装

##### 步骤3：验证安装

打开 **终端（Terminal）**，输入：

```bash
node -v
npm -v
npx -v
```

---

### Linux 安装教程

#### Ubuntu/Debian

##### 方式1：使用NodeSource仓库（推荐）

```bash
## 更新包列表
sudo apt update

## 安装curl（如果还没有）
sudo apt install -y curl

## 添加NodeSource仓库（Node.js 20.x LTS）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

## 安装Node.js和npm
sudo apt install -y nodejs

## 验证安装
node -v
npm -v
npx -v
```

##### 方式2：使用apt（版本可能较旧）

```bash
sudo apt update
sudo apt install -y nodejs npm
```

---

#### CentOS/RHEL/Fedora

```bash
## 添加NodeSource仓库
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -

## 安装Node.js
sudo yum install -y nodejs

## 验证安装
node -v
npm -v
npx -v
```

---

#### Arch Linux

```bash
## 使用pacman安装
sudo pacman -S nodejs npm

## 验证安装
node -v
npm -v
npx -v
```

---

### 验证安装

#### 完整验证步骤

安装完成后，运行以下命令进行完整验证：

```bash
## 1. 检查版本
node -v
npm -v
npx -v

## 2. 测试Node.js
node -e "console.log('Node.js 工作正常！')"

## 3. 测试npm
npm --version

## 4. 测试npx（运行一个简单的包）
npx cowsay "Hello MCP!"
```

#### 预期输出

```
v20.11.0
10.2.4
10.2.4
Node.js 工作正常！
10.2.4
 _____________
< Hello MCP! >
 -------------
        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
```

---

### 测试MCP服务器连接

安装完成后，测试连接到社区MCP服务器：

#### 测试文件系统服务器

```bash
## 使用npx运行文件系统MCP服务器
npx -y @modelcontextprotocol/server-filesystem .
```

如果看到服务器启动信息，说明一切正常！

#### 在Python中测试

创建测试脚本 `test_mcp.py`：

```python
import asyncio
from hello_agents.protocols import MCPClient

async def test():
    client = MCPClient([
        "npx", "-y",
        "@modelcontextprotocol/server-filesystem",
        "."
    ])
    
    async with client:
        tools = await client.list_tools()
        print(f"✅ 成功连接！可用工具: {[t['name'] for t in tools]}")

asyncio.run(test())
```

运行：

```bash
python test_mcp.py
```

---

### 常见问题

#### Q1: 安装后命令找不到

**Windows**:
```powershell
## 检查环境变量
echo $env:PATH

## 手动添加Node.js到PATH
## 1. 右键"此电脑" -> "属性"
## 2. "高级系统设置" -> "环境变量"
## 3. 在"系统变量"中找到"Path"
## 4. 添加：C:\Program Files\nodejs\
```

**macOS/Linux**:
```bash
## 检查环境变量
echo $PATH

## 添加到~/.bashrc 或 ~/.zshrc
export PATH="/usr/local/bin:$PATH"
source ~/.bashrc  # 或 source ~/.zshrc
```

---

#### Q2: npm速度很慢

使用国内镜像源（淘宝镜像）：

```bash
## 临时使用
npm install --registry=https://registry.npmmirror.com

## 永久设置
npm config set registry https://registry.npmmirror.com

## 验证
npm config get registry
```

---

#### Q3: npx权限错误

**Windows**:
```powershell
## 以管理员身份运行PowerShell
```

**macOS/Linux**:
```bash
## 不要使用sudo运行npx
## 如果遇到权限问题，修复npm全局目录权限
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

---

#### Q4: 版本冲突

如果需要管理多个Node.js版本，推荐使用版本管理工具：

**Windows**: [nvm-windows](https://github.com/coreybutler/nvm-windows)

```powershell
## 安装nvm-windows后
nvm install 20.11.0
nvm use 20.11.0
```

**macOS/Linux**: [nvm](https://github.com/nvm-sh/nvm)

```bash
## 安装nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

## 安装Node.js
nvm install 20
nvm use 20
```

---

#### Q5: npx下载包很慢

```bash
## 方式1：使用国内镜像
npx --registry=https://registry.npmmirror.com @modelcontextprotocol/server-filesystem

## 方式2：先全局安装，再使用
npm install -g @modelcontextprotocol/server-filesystem
server-filesystem
```

---

### 下一步

安装完成后，你可以：

1. ✅ 运行 `code/02_Connect2MCP.py` 测试MCP客户端连接
2. ✅ 探索社区MCP服务器：https://github.com/modelcontextprotocol/servers
3. ✅ 继续学习第十章的其他内容

---

### 参考资源

- **Node.js官网**: https://nodejs.org/
- **npm文档**: https://docs.npmjs.com/
- **npx文档**: https://docs.npmjs.com/cli/v10/commands/npx
- **MCP服务器列表**: https://github.com/modelcontextprotocol/servers
- **淘宝npm镜像**: https://npmmirror.com/

---

**祝你学习愉快！** 🎉

如有问题，请参考常见问题部分或查阅官方文档。


