FROM pgvector/pgvector:pg17
# 安装 zhparser 中文分词
RUN apt-get update && apt-get install -y postgresql-17-zhparser || \
    (apt-get install -y build-essential postgresql-server-dev-17 wget && \
     cd /tmp && wget https://github.com/amutu/zhparser/archive/master.tar.gz && \
     tar xzf master.tar.gz && cd zhparser-master && \
     SCRAM_BUILD_DIR=/tmp make && SCRAM_BUILD_DIR=/tmp make install && \
     rm -rf /tmp/zhparser-master /tmp/master.tar.gz) && \
    apt-get clean
