set names utf8mb4;
set foreign_key_checks = 0;

create table `vmcache` (`user_id` varchar(255) not null, `resource_id` varchar(255) not null, primary key (`user_id`)) default character set utf8mb4 engine = InnoDB;
alter table `vmcache` add unique `vmcache_resource_id_unique`(`resource_id`);

create table `user` (`id` varchar(255) not null, `email` varchar(255) not null, `password` varchar(255) not null, `subscribed` tinyint(1) not null, `created_at` datetime not null, `edited_at` datetime not null, primary key (`id`)) default character set utf8mb4 engine = InnoDB;

set foreign_key_checks = 1;

[32mSchema successfully created[39m
