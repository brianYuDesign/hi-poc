#!/bin/bash
# 验证 proto 文件路径的脚本

echo "🔍 验证 proto 文件路径..."
echo ""

# 检查源码 proto 文件
echo "1. 检查源码 proto 文件:"
if [ -f "src/api/proto/balance.proto" ]; then
    echo "   ✅ src/api/proto/balance.proto 存在"
else
    echo "   ❌ src/api/proto/balance.proto 不存在"
fi
echo ""

# 检查编译后的 proto 文件
echo "2. 检查编译后的 proto 文件:"
if [ -f "dist/api/proto/balance.proto" ]; then
    echo "   ✅ dist/api/proto/balance.proto 存在"
else
    echo "   ❌ dist/api/proto/balance.proto 不存在"
    echo "   运行: npm run build"
fi
echo ""

# 检查编译后的 server.js
echo "3. 检查编译后的 server.js:"
if [ -f "dist/api/grpc/server.js" ]; then
    echo "   ✅ dist/api/grpc/server.js 存在"
    # 检查是否引用了 proto 文件
    if grep -q "balance.proto" dist/api/grpc/server.js; then
        echo "   ✅ server.js 包含 proto 文件引用"
    else
        echo "   ⚠️  server.js 未找到 proto 文件引用"
    fi
else
    echo "   ❌ dist/api/grpc/server.js 不存在"
    echo "   运行: npm run build"
fi
echo ""

echo "✅ 验证完成！"
echo ""
echo "如果所有检查都通过，可以运行:"
echo "  npm start"
